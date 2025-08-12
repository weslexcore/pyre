## Project overview / description
Add a visually calming “break” section to the homepage placed between the `EXPERIENCE` section and the `SIGN UP` section. The section features a large quote over a low‑opacity background image, with a rotating word effect inside the sentence “PYRE IS A SPACE TO ____________”. A CTA button below the quote reads “SPEND TIME WITH US” and routes users to sign up for the mailing list.

## Target audience
- New and returning visitors exploring PYRE’s offerings
- People curious about community, wellness, and ritual who may consider joining the mailing list

## Primary benefits / features
- **Visual pause**: Creates a gentle interlude between content sections to reset attention and elevate brand tone.
- **Hero quote with rotating word**: Large typographic treatment for “PYRE IS A SPACE TO ____________”, cycling every few seconds through: [blank], RECONNECT, DISCONNECT, MAKE A FRIEND, BREATHE, HEAL.
- **Background image**: Uses `public/images/giant_clouds.jpeg` at ~0.2 opacity with an overlay to ensure text contrast and readability.
- **CTA**: Prominent button “SPEND TIME WITH US” linking to the mailing list signup (scroll/jump to existing signup section or deep link to `/#signup`).
- **Accessibility**: Sufficient color contrast, reduced‑motion preference respected for word rotation; semantic heading/paragraph structure.
- **Responsiveness & performance**: Mobile‑first layout, lazy loading, optimized image delivery.

## High‑level tech / architecture
- **Astro component** inserted between existing `EXPERIENCES` and `SIGNUP` components on the homepage.
- **Tailwind‑first styling** for layout, typography, spacing, and overlays per the design system.
- **Asset**: Background from `public/images/giant_clouds.jpeg` with an overlay to achieve ~0.2 visual opacity (non‑destructive to the image asset).
- **Word rotation**: Lightweight client script in the component to cycle the word list on an interval; respects `prefers-reduced-motion` and uses `aria-live="polite"` for minimal announcements.
- **CTA routing**: Anchor link to the signup section ID or route to the mailing list API/form depending on current site pattern.
- **Content management**: Word list and interval kept as component props or local constants for easy updates without code restructuring.
