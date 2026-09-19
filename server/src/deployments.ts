import { getAddress, type Address } from 'viem';
import { sproutFactoryAbi, sproutVaultAbi } from '@sprout/shared';
import { ChainConfigError, chainCache, requirePublic, type ChainContext } from './chain';
import { deploymentFor, type Deployment } from './config';
import type { SproutDb } from './db';
import { FOREVER_MS } from './readCache';
import { setSproutFactory, type SproutRecord } from './repo';

/**
 * Which factory a sprout belongs to, and so which venue it may trade through.
 *
 * Contracts cannot change after deployment. A vault checks every purchase
 * against its own factory's admission list, so a sprout planted by the legacy
 * factory can only ever buy through the legacy venue, and a sprout planted by
 * the current factory only through the current one. The server never guesses:
 * it reads vault.factory() and looks that factory up in its configuration.
 */

/** A vault created by a factory this server is not configured for. */
export class UnknownFactoryError extends ChainConfigError {
  readonly vault: Address;
  readonly factory: Address;
  constructor(vault: Address, factory: Address) {
    super(
      `Sprout ${vault} was created by factory ${factory}, which this server is not configured for ` +
        '(SPROUT_FACTORY_ADDRESS or SPROUT_LEGACY_DEPLOYMENTS). Refusing to trade for it.',
    );
    this.name = 'UnknownFactoryError';
    this.vault = vault;
    this.factory = factory;
  }
}

/** vault.factory() is set once at initialization, so a successful read is kept for good. */
export function vaultFactory(ctx: ChainContext, vault: Address): Promise<Address> {
  const client = requirePublic(ctx);
  return chainCache(ctx).get(`vault:${vault.toLowerCase()}:factory`, FOREVER_MS, async () =>
    getAddress((await client.readContract({ address: vault, abi: sproutVaultAbi, functionName: 'factory' })) as Address),
  );
}

/** Admission is fixed in the factory's constructor, so these are kept for good too. */
export function factoryAdmitsVenue(ctx: ChainContext, factory: Address, venue: Address): Promise<boolean> {
  const client = requirePublic(ctx);
  return chainCache(ctx).get(`factory:${factory.toLowerCase()}:venue:${venue.toLowerCase()}`, FOREVER_MS, async () =>
    Boolean(await client.readContract({ address: factory, abi: sproutFactoryAbi, functionName: 'isAdmittedVenue', args: [venue] })),
  );
}

export function factoryAdmittedAssets(ctx: ChainContext, factory: Address): Promise<Address[]> {
  const client = requirePublic(ctx);
  return chainCache(ctx).get(`factory:${factory.toLowerCase()}:assets`, FOREVER_MS, async () => {
    const assets = (await client.readContract({ address: factory, abi: sproutFactoryAbi, functionName: 'admittedAssets' })) as readonly Address[];
    return assets.map((asset) => getAddress(asset));
  });
}

export interface VaultVenue {
  factory: Address;
  venue: Address;
  deployment: Deployment;
}

/**
 * The venue a vault's purchases must go through. Fails closed: a factory the
 * configuration does not list throws UnknownFactoryError, and a deployment
 * whose venue is missing or not admitted by its factory throws ChainConfigError.
 */
export async function resolveVaultVenue(ctx: ChainContext, vault: Address): Promise<VaultVenue> {
  const factory = await vaultFactory(ctx, vault);
  const deployment = deploymentFor(ctx.config, factory);
  if (!deployment) throw new UnknownFactoryError(vault, factory);
  const venue = deployment.venue;
  if (!venue) throw new ChainConfigError('SPROUT_VENUE_ADDRESS is not configured');
  // A venue the factory does not admit reverts on-chain; say why before trying.
  if (!(await factoryAdmitsVenue(ctx, deployment.factory, venue))) {
    throw new ChainConfigError(
      `Venue ${venue} is not admitted by factory ${deployment.factory}; check ` +
        (deployment.current ? 'SPROUT_VENUE_ADDRESS' : 'SPROUT_LEGACY_DEPLOYMENTS'),
    );
  }
  return { factory: deployment.factory, venue, deployment };
}

export interface SproutDeploymentView {
  /** The factory that created the sprout, or null when it cannot be read right now. */
  factory: string | null;
  /**
   * Assets that factory admits: the only ones this sprout may ever hold. Null
   * when the factory is unknown to this server or cannot be read right now.
   */
  admittedAssets: Address[] | null;
}

/**
 * The factory and admitted assets for an API response. The factory comes from
 * the index when known, else from vault.factory() (then stored). Never throws:
 * a read failure yields nulls, which the web treats as "nothing to offer".
 */
export async function sproutDeploymentView(ctx: ChainContext, db: SproutDb, sprout: SproutRecord): Promise<SproutDeploymentView> {
  let factory = sprout.factory;
  if (!factory) {
    try {
      factory = await vaultFactory(ctx, sprout.id as Address);
      setSproutFactory(db, sprout.id, factory);
    } catch {
      return { factory: null, admittedAssets: null };
    }
  }
  factory = /^0x[0-9a-fA-F]{40}$/.test(factory) ? getAddress(factory) : factory;
  const deployment = deploymentFor(ctx.config, factory);
  if (!deployment) return { factory, admittedAssets: null };
  try {
    return { factory, admittedAssets: await factoryAdmittedAssets(ctx, deployment.factory) };
  } catch {
    return { factory, admittedAssets: null };
  }
}
