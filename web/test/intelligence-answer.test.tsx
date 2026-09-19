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
    '<ol start="1"><li><strong>Make two lists</strong>: Needs and wants.</li><li>Compare them.</li></ol>',
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

test("headings, paragraphs and bullet lists have readable document structure", () => {
  const html = renderToStaticMarkup(
    <AnswerText
      text={
        "## Try this together\nA small activity.\n\n- **Needs**: essentials\n- Wants: extras\n\nDiscuss the difference."
      }
    />,
  );
  expect(html).toContain("<h3>Try this together</h3><p>A small activity.</p>");
  expect(html).toContain(
    "<ul><li><strong>Needs</strong>: essentials</li><li>Wants: extras</li></ul>",
  );
  expect(html).toContain("<p>Discuss the difference.</p>");
});

test("list numbering, continuation lines, and adjacent paragraphs stay intact", () => {
  const html = renderToStaticMarkup(
    <AnswerText
      text={"3. Talk it through\n   Ask why.\n4. Reflect\nNext question?"}
    />,
  );
  expect(html).toContain(
    '<ol start="3"><li>Talk it through\nAsk why.</li><li>Reflect</li></ol><p>Next question?</p>',
  );
});
