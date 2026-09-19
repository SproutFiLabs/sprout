/** Render the model's inline emphasis as React text, never as trusted HTML. */
export function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*\n]+\*\*)/g)
        .map((part, index) =>
          part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
            <strong key={index}>{part.slice(2, -2)}</strong>
          ) : (
            part
          ),
        )}
    </>
  );
}
