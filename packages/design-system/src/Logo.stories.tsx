import type { Meta, StoryObj } from "@storybook/react-vite";
import { Logo } from "./Logo";

const meta = {
  title: "Brand/Logo",
  component: Logo,
  tags: ["autodocs"],
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Wordmark: Story = { args: { size: 56 } };

export const OnInk: Story = {
  render: () => (
    <div
      style={{
        background: "#23221c",
        padding: 32,
        borderRadius: 14,
        display: "inline-block",
        color: "#f5f1e9",
      }}
    >
      <Logo size={56} />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
      <Logo size={28} />
      <Logo size={40} />
      <Logo size={56} />
    </div>
  ),
};
