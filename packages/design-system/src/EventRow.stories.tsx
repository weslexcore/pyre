import type { Meta, StoryObj } from "@storybook/react-vite";
import { EventRow } from "./EventRow";

const meta = {
  title: "Components/EventRow",
  component: EventRow,
  tags: ["autodocs"],
  // EventRow lives on the events page's dark ground — wrap so it's legible.
  decorators: [
    (Story) => (
      <div style={{ background: "var(--pyre-black)", padding: "var(--space-3)", borderRadius: 14, width: 560 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Full Moon Sauna",
    time: "Sat · 7:00 PM",
    spotsRemaining: 8,
    totalSpots: 16,
    ctaLabel: "Book",
  },
} satisfies Meta<typeof EventRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AlmostFull: Story = { args: { spotsRemaining: 2, title: "Guided Breathwork" } };

export const SoldOut: Story = { args: { spotsRemaining: 0, title: "Sunrise Social" } };

export const Schedule: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <EventRow title="Sunrise Social" time="Sat · 7:00 AM" spotsRemaining={12} totalSpots={16} />
      <EventRow title="Guided Breathwork" time="Sat · 12:00 PM" spotsRemaining={2} totalSpots={16} />
      <EventRow title="Full Moon Sauna" time="Sat · 7:00 PM" spotsRemaining={0} totalSpots={16} />
    </div>
  ),
};
