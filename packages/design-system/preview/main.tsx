import { createRoot } from "react-dom/client";
import {
  Badge,
  Button,
  Card,
  ColorPalette,
  Heading,
  Input,
  Logo,
  SessionCard,
} from "../src/index";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "var(--space-8)" }}>
      <Heading level={4} eyebrow="Component">
        {title}
      </Heading>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          alignItems: "flex-start",
          marginTop: "var(--space-2)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Gallery() {
  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
      <header style={{ marginBottom: "var(--space-12)" }}>
        <Logo size={64} />
        <Heading level={1} style={{ marginTop: "var(--space-2)" }}>
          Pyre Design System
        </Heading>
        <p style={{ color: "var(--muted-foreground)", maxWidth: 540 }}>
          Live preview of every component, rendered from the real package source.
        </p>
      </header>

      <Section title="Color palette">
        <ColorPalette />
      </Section>

      <Section title="Headings">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <Heading level={1}>Self-care together</Heading>
          <Heading level={2}>Sessions every day</Heading>
          <Heading level={3}>Social, Silent, Guided</Heading>
          <Heading level={2} eyebrow="Membership">
            Heat, on your schedule
          </Heading>
        </div>
      </Section>

      <Section title="Buttons">
        <Button variant="primary">Book a session</Button>
        <Button variant="secondary">View schedule</Button>
        <Button variant="outline">Learn more</Button>
        <Button variant="cta">Become a member</Button>
        <Button variant="primary" disabled>
          Sold out
        </Button>
      </Section>

      <Section title="Badges">
        <Badge tone="red">Social</Badge>
        <Badge tone="blue">Silent</Badge>
        <Badge tone="gold">Guided</Badge>
        <Badge tone="sage">Waitlist</Badge>
        <Badge tone="outline">3 spots left</Badge>
      </Section>

      <Section title="Inputs">
        <div style={{ width: 280 }}>
          <Input label="Email" type="email" placeholder="you@example.com" />
        </div>
        <div style={{ width: 280 }}>
          <Input label="Email" defaultValue="not-an-email" error="Enter a valid email address" />
        </div>
      </Section>

      <Section title="Cards">
        <Card heading="Community Sauna" style={{ width: 300 }}>
          Wood-fired heat on the waterfront. Cycle between the sauna and a cold plunge.
        </Card>
        <Card variant="ink" heading="Members get more" style={{ width: 300 }}>
          Priority booking, four sessions a month, and guest passes.
        </Card>
        <Card variant="elevated" heading="Private rental" style={{ width: 300 }}>
          <p style={{ margin: "0 0 16px" }}>Book the whole sauna for up to eight guests.</p>
          <Button size="sm" variant="primary">
            Enquire
          </Button>
        </Card>
      </Section>

      <Section title="Session cards">
        <SessionCard type="Social" time="Sat · 4:00 PM" price="$45" slotsLeft={6} />
        <SessionCard type="Silent" time="Sun · 7:00 AM" price="$40" slotsLeft={3} />
        <SessionCard type="Guided" time="Fri · 6:30 PM" price="$55" slotsLeft={2} />
        <SessionCard type="Social" time="Sat · 6:00 PM" price="$45" slotsLeft={0} />
      </Section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
