import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionCard } from "./SessionCard";

const meta = {
  title: "Components/SessionCard",
  component: SessionCard,
  tags: ["autodocs"],
  argTypes: {
    type: { control: "select", options: ["Social", "Silent", "Guided"] },
  },
} satisfies Meta<typeof SessionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Social: Story = {
  args: { type: "Social", time: "Sat · 4:00 PM", price: "$45", slotsLeft: 6 },
};

export const Guided: Story = {
  args: { type: "Guided", time: "Fri · 6:30 PM", price: "$55", slotsLeft: 2 },
};

export const SoldOut: Story = {
  args: { type: "Social", time: "Sat · 6:00 PM", price: "$45", slotsLeft: 0 },
};

export const Schedule: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      <SessionCard type="Social" time="Sat · 4:00 PM" price="$45" slotsLeft={6} />
      <SessionCard type="Silent" time="Sun · 7:00 AM" price="$40" slotsLeft={3} />
    </div>
  ),
};
