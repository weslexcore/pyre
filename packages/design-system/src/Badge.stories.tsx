import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: { children: "Social" },
  argTypes: {
    tone: { control: "select", options: ["red", "blue", "gold", "sage", "outline"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Social: Story = { args: { tone: "red", children: "Social" } };
export const Silent: Story = { args: { tone: "blue", children: "Silent" } };
export const Guided: Story = { args: { tone: "gold", children: "Guided" } };

export const SessionTypes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Badge tone="red">Social</Badge>
      <Badge tone="blue">Silent</Badge>
      <Badge tone="gold">Guided</Badge>
      <Badge tone="sage">Waitlist</Badge>
      <Badge tone="outline">3 spots left</Badge>
    </div>
  ),
};
