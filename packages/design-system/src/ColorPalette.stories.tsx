import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColorPalette } from "./ColorPalette";

const meta = {
  title: "Foundations/Color Palette",
  component: ColorPalette,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof ColorPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Brand: Story = {};
