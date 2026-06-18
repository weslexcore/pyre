import { Button } from "@pyre/design-system";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button variant="primary">Book a session</Button>
      <Button variant="secondary">View schedule</Button>
      <Button variant="outline">Learn more</Button>
      <Button variant="cta">Become a member</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function AsLink() {
  return (
    <Button href="#book" variant="primary">
      Reserve your spot
    </Button>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <Button variant="primary" disabled>
        Sold out
      </Button>
      <Button variant="outline" disabled>
        Unavailable
      </Button>
    </div>
  );
}
