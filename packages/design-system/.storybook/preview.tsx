import type { Preview } from "@storybook/react-vite";
import "../styles.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      options: {
        creme: { name: "Creme", value: "#f5f1e9" },
        ink: { name: "Ink", value: "#23221c" },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: "creme" },
  },
  decorators: [
    (Story) => (
      <div style={{ fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
