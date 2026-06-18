import { Heading } from "@pyre/design-system";

export function Levels() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Heading level={1}>Self-care together</Heading>
      <Heading level={2}>Sessions every day</Heading>
      <Heading level={3}>Social, Silent, Guided</Heading>
      <Heading level={4}>Booking opens Monday</Heading>
    </div>
  );
}

export function WithEyebrow() {
  return (
    <Heading level={2} eyebrow="Membership">
      Heat, on your schedule
    </Heading>
  );
}
