import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerText } from "../src/intelligence/AnswerText";

test("live numbered answers display emphasis and preserve paragraphs", () => {
  const html = renderToStaticMarkup(
    <AnswerText
      text={"1. **Make two lists**: Needs and wants.\n\n2. Compare them."}
    />,
  );
  expect(html).toBe(
    "1. <strong>Make two lists</strong>: Needs and wants.\n\n2. Compare them.",
  );
});

test("model-supplied HTML remains inert text, including inside emphasis", () => {
  const html = renderToStaticMarkup(
    <AnswerText
      text={"**<img src=x onerror=alert(1)>** <script>alert(1)</script>"}
    />,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<strong>&lt;img");
});
