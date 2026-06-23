import type { Meta, StoryObj } from "@storybook/react-vite";
import { EventCard } from "./EventCard";

const meta = {
  title: "Components/EventCard",
  component: EventCard,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "ink"] },
  },
  args: {
    title: "Full Moon Sauna",
    description: "An evening of wood-fired heat, cold plunges, and quiet under the full moon.",
    date: "Sat, Jun 28",
    time: "7:00 PM",
    location: "Waterfront Sauna",
    spotsRemaining: 8,
    totalSpots: 16,
    ctaLabel: "Book now",
  },
} satisfies Meta<typeof EventCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Ink: Story = { args: { variant: "ink" } };

export const AlmostFull: Story = {
  args: { spotsRemaining: 2, title: "Guided Breathwork" },
};

export const SoldOut: Story = {
  args: { spotsRemaining: 0, title: "Sunrise Social" },
};

export const WithImage: Story = {
  args: {
    image: {
      src:
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="144"><rect width="320" height="144" fill="%23274868"/><rect width="320" height="144" fill="url(%23g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23d15232"/><stop offset="1" stop-color="%23dbb155"/></linearGradient></defs></svg>',
        ),
      alt: "Event cover",
    },
    title: "Members Night",
  },
};
