import { z } from "zod";
import { getAddress, parseUnits } from "viem";
import { SPEND_USDC, type SpendProduct, type SpendOrder } from "@sprout/shared";
export interface SpendProvider {
  catalog(country: string): Promise<SpendProduct[]>;
  create(
    product: SpendProduct,
    value: number,
    refundAddress: string,
  ): Promise<{
    invoiceId: string;
    order: Pick<SpendOrder, "status" | "payment">;
  }>;
  status(invoiceId: string): Promise<Pick<SpendOrder, "status" | "redemption">>;
}
const positive = z.coerce.number().positive().finite();
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  country_code: z.string(),
  currency: z.string(),
  in_stock: z.boolean(),
  recipient_type: z.string(),
  packages: z
    .array(
      z.object({
        id: z.string().optional(),
        package_id: z.string().optional(),
        value: positive,
      }),
    )
    .optional(),
  range: z.object({ min: positive, max: positive, step: positive }).optional(),
});
const invoiceSchema = z.object({
  id: z.string(),
  status: z.string(),
  payment: z.object({
    method: z.string(),
    address: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional(),
    status: z.string(),
  }),
  orders: z.array(z.object({ id: z.string(), status: z.string() })),
});
export class SpendProviderError extends Error {
  constructor(
    message = "Purchasing is temporarily unavailable. Please try again later.",
  ) {
    super(message);
  }
}
/** Business API only. No platform-balance payments, provider credentials or customer emails reach the browser. */
export function bitrefillProvider(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): SpendProvider | undefined {
  if (
    env.SPROUT_SPEND_ENABLED !== "true" ||
    !env.BITREFILL_API_ID ||
    !env.BITREFILL_API_SECRET
  )
    return;
  const allowlist = (env.SPROUT_SPEND_PRODUCT_IDS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!allowlist.length) return;
  const authorization = `Basic ${Buffer.from(`${env.BITREFILL_API_ID}:${env.BITREFILL_API_SECRET}`).toString("base64")}`;
  const call = async (path: string, body?: unknown) => {
    const response = await request(`https://api.bitrefill.com/v2${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok) throw new SpendProviderError();
    const payload = (await response.json()) as { data: unknown };
    return payload.data;
  };
  const product = async (id: string) => {
    if (!allowlist.includes(id)) throw new SpendProviderError();
    return productSchema.parse(
      await call(`/products/${encodeURIComponent(id)}`),
    );
  };
  const choices = (p: z.infer<typeof productSchema>) =>
    p.packages?.map((x) => x.value) ??
    [5, 10, 15, 20, 25, 50, 75, 100].filter(
      (v) =>
        p.range &&
        v >= p.range.min &&
        v <= p.range.max &&
        Math.abs(
          (v - p.range.min) / p.range.step -
            Math.round((v - p.range.min) / p.range.step),
        ) < 1e-6,
    );
  let cache:
    { country: string; expires: number; products: SpendProduct[] } | undefined;
  return {
    async catalog(country) {
      if (cache?.country === country && cache.expires > Date.now())
        return cache.products;
      const products: SpendProduct[] = [];
      for (const id of allowlist.slice(0, 30)) {
        const p = await product(id);
        if (
          p.in_stock &&
          p.recipient_type === "none" &&
          p.currency === "USD" &&
          p.country_code === country
        )
          products.push({
            id: p.id,
            name: p.name,
            country: p.country_code,
            currency: p.currency,
            values: choices(p).filter((v) => Number.isInteger(v) && v <= 100),
            category: "Gift cards",
          });
      }
      cache = {
        country,
        products: products.filter((p) => p.values.length),
        expires: Date.now() + 300000,
      };
      return cache.products;
    },
    async create(selected, value, refundAddress) {
      const p = await product(selected.id);
      if (
        !p.in_stock ||
        p.recipient_type !== "none" ||
        p.country_code !== selected.country ||
        p.currency !== "USD" ||
        !choices(p).includes(value)
      )
        throw new SpendProviderError(
          "This product or amount is no longer available.",
        );
      const pack = p.packages?.find((x) => x.value === value);
      if (pack && !(pack.id || pack.package_id)) throw new SpendProviderError();
      const invoice = invoiceSchema.parse(
        await call("/invoices", {
          products: [
            {
              product_id: p.id,
              ...(pack
                ? { package_id: pack.id || pack.package_id }
                : { value }),
              quantity: 1,
            },
          ],
          payment_method: "usdc_base",
          refund_address: refundAddress,
          auto_pay: false,
          send_email: false,
        }),
      );
      if (
        invoice.payment.method !== "usdc_base" ||
        invoice.payment.status !== "unpaid" ||
        !invoice.payment.address ||
        invoice.payment.currency?.toUpperCase() !== "USDC"
      )
        throw new SpendProviderError();
      const amount = String(invoice.payment.price);
      if (
        !/^\d+(\.\d{1,6})?$/.test(amount) ||
        parseUnits(amount, 6) <= 0n ||
        parseUnits(amount, 6) > 110_000000n
      )
        throw new SpendProviderError();
      // Three-minute local payment window; recheck the invoice immediately before sending.
      return {
        invoiceId: invoice.id,
        order: {
          status: "unpaid",
          payment: {
            address: getAddress(invoice.payment.address),
            amount,
            chainId: 8453,
            token: SPEND_USDC,
            expiresAt: Date.now() + 180000,
          },
        },
      };
    },
    async status(id) {
      const invoice = invoiceSchema.parse(
        await call(`/invoices/${encodeURIComponent(id)}`),
      );
      if (invoice.id !== id) throw new SpendProviderError();
      if (
        invoice.status === "complete" &&
        invoice.orders.length === 1 &&
        invoice.orders[0]!.status === "delivered"
      ) {
        const order = z
          .object({
            id: z.string(),
            status: z.string(),
            invoice: z.object({ id: z.string() }),
            redemption_info: z.union([
              z.string(),
              z.object({
                code: z.string().optional(),
                pin: z.string().optional(),
                instructions: z.string().optional(),
                link: z.string().optional(),
              }),
            ]),
          })
          .parse(
            await call(`/orders/${encodeURIComponent(invoice.orders[0]!.id)}`),
          );
        if (
          order.invoice.id !== id ||
          order.id !== invoice.orders[0]!.id ||
          order.status !== "delivered"
        )
          throw new SpendProviderError();
        const redemption =
          typeof order.redemption_info === "string"
            ? { instructions: order.redemption_info }
            : order.redemption_info;
        if (redemption.link && !redemption.link.startsWith("https://"))
          delete redemption.link;
        return { status: "delivered", redemption };
      }
      if (
        ["denied", "payment_error", "blocked", "refunded"].includes(
          invoice.status,
        )
      )
        return { status: "attention" };
      if (["expired", "cancelled"].includes(invoice.status))
        return { status: "expired" };
      if (invoice.payment.status === "unpaid") return { status: "unpaid" };
      return { status: "confirming" };
    },
  };
}
