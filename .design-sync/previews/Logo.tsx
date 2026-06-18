import { Logo } from "@pyre/design-system";

export function Wordmark() {
  return <Logo size={56} />;
}

export function OnInk() {
  return (
    <div
      style={{
        background: "#23221c",
        padding: 32,
        borderRadius: 14,
        display: "inline-block",
        color: "#f5f1e9",
      }}
    >
      <Logo size={56} />
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
      <Logo size={28} />
      <Logo size={40} />
      <Logo size={56} />
    </div>
  );
}
