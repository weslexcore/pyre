import { Badge } from "@pyre/design-system";

export function SessionTypes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Badge tone="red">Social</Badge>
      <Badge tone="blue">Silent</Badge>
      <Badge tone="gold">Guided</Badge>
    </div>
  );
}

export function Tones() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <Badge tone="red">New</Badge>
      <Badge tone="blue">Booked</Badge>
      <Badge tone="gold">Members</Badge>
      <Badge tone="sage">Waitlist</Badge>
    </div>
  );
}

export function Outline() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Badge tone="outline">3 spots left</Badge>
      <Badge tone="outline">60 min</Badge>
    </div>
  );
}
