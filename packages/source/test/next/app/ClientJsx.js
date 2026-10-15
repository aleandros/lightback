'use client';

export default function ClientJsx() {
  const probe = () => { try { throw new Error('lightback-jsx-map-probe'); } catch (error) { window.jsxProbeMessage = error.message; } };
  return <button data-action="jsx-probe" onClick={probe}>JSX map probe</button>;
}
