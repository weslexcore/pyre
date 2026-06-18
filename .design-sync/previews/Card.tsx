import { Button, Card } from "@pyre/design-system";

export function Default() {
  return (
    <Card heading="Community Sauna" style={{ width: 320 }}>
      Wood-fired heat on the waterfront. Cycle between the sauna and a cold
      plunge, then rest by the fire.
    </Card>
  );
}

export function Ink() {
  return (
    <Card variant="ink" heading="Members get more" style={{ width: 320 }}>
      Priority booking, four sessions a month, and guest passes for the people
      you want to bring into the heat.
    </Card>
  );
}

export function Gradient() {
  return (
    <Card variant="gradient" heading="Founding member" style={{ width: 320 }}>
      Lock in launch pricing for life and get first access to every new
      location.
    </Card>
  );
}

export function Elevated() {
  return (
    <Card variant="elevated" heading="Private rental" style={{ width: 320 }}>
      <p style={{ margin: "0 0 16px" }}>
        Book the whole sauna for your group — up to eight guests.
      </p>
      <Button size="sm" variant="primary">
        Enquire
      </Button>
    </Card>
  );
}
