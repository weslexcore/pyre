import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["default", "ink", "elevated", "gradient"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    heading: "Community Sauna",
    style: { width: 320 },
    children:
      "Wood-fired heat on the waterfront. Cycle between the sauna and a cold plunge, then rest by the fire.",
  },
};

export const Ink: Story = {
  args: {
    variant: "ink",
    heading: "Members get more",
    style: { width: 320 },
    children: "Priority booking, four sessions a month, and guest passes.",
  },
};

export const Gradient: Story = {
  args: {
    variant: "gradient",
    heading: "Founding member",
    style: { width: 320 },
    children: "Lock in launch pricing for life and get first access to every new location.",
  },
};

export const Elevated: Story = {
  render: () => (
    <Card variant="elevated" heading="Private rental" style={{ width: 320 }}>
      <p style={{ margin: "0 0 16px" }}>Book the whole sauna for up to eight guests.</p>
      <Button size="sm" variant="primary">
        Enquire
      </Button>
    </Card>
  ),
};
