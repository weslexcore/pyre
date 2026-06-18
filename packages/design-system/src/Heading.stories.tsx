import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heading } from "./Heading";

const meta = {
  title: "Components/Heading",
  component: Heading,
  tags: ["autodocs"],
  args: { children: "Heat, on your schedule" },
  argTypes: {
    level: { control: { type: "inline-radio" }, options: [1, 2, 3, 4] },
  },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

// Level 1 is forced uppercase by the brand.
export const Display: Story = { args: { level: 1, children: "Self-care together" } };
export const WithEyebrow: Story = { args: { level: 2, eyebrow: "Membership" } };

export const Levels: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Heading level={1}>Self-care together</Heading>
      <Heading level={2}>Sessions every day</Heading>
      <Heading level={3}>Social, Silent, Guided</Heading>
      <Heading level={4}>Booking opens Monday</Heading>
    </div>
  ),
};
