export function DemoBanner({ localDemo }: { localDemo: boolean }) {
  if (!localDemo) return null;
  return (
    <div className="demo-banner" role="status">
      <strong>LOCAL DEMO</strong>
      <span>Anvil chain with mock assets and development accounts. No real value.</span>
    </div>
  );
}
