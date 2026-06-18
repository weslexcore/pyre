import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input";

const meta = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
  decorators: [(Story) => <div style={{ width: 280 }}>{Story()}</div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLabel: Story = {
  args: { label: "Email", type: "email", placeholder: "you@example.com" },
};

export const Filled: Story = {
  args: { label: "Full name", defaultValue: "Ada Lovelace" },
};

export const WithError: Story = {
  args: {
    label: "Email",
    defaultValue: "not-an-email",
    error: "Enter a valid email address",
  },
};

export const Plain: Story = { args: { placeholder: "Search sessions…" } };
