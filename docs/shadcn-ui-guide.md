# shadcn/ui Integration Guide

This guide explains how to use shadcn/ui components in your Astro project.

## Overview

shadcn/ui is a collection of re-usable components built with Radix UI and Tailwind CSS. In this Astro project, we use shadcn/ui components for consistent, accessible, and beautiful UI elements.

## Available Components

Currently installed components:
- `button` - Interactive button component
- `card` - Container component for content
- `input` - Form input component
- `dialog` - Modal dialog component

## Adding New Components

To add a new shadcn/ui component:

```bash
yarn dlx shadcn@latest add [component-name]
```

Example:
```bash
yarn dlx shadcn@latest add badge
yarn dlx shadcn@latest add dropdown-menu
yarn dlx shadcn@latest add toast
```

## Using Components in Astro

### Method 1: Direct Import (Recommended for React components)

```astro
---
import { Button } from '@/components/ui/button';
---

<Button>Click me</Button>
```

### Method 2: Copy Classes (For Astro components)

You can copy the Tailwind classes from shadcn/ui components and use them directly in Astro components:

```astro
---
// No imports needed
---

<button class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
  Click me
</button>
```

### Method 3: Hybrid Approach

Use shadcn/ui classes in Astro components for styling consistency:

```astro
---
// Astro component with shadcn/ui styling
---

<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
  <div class="p-6">
    <h3 class="text-2xl font-semibold leading-none tracking-tight">Card Title</h3>
    <p class="text-sm text-muted-foreground mt-2">Card content</p>
  </div>
</div>
```

## Component Guidelines

### When to Use Each Method

1. **Direct Import**: Use for interactive components that need React functionality
2. **Copy Classes**: Use for static content in Astro components
3. **Hybrid**: Use for consistent styling across the project

### Best Practices

- Always start with shadcn/ui components when building new UI elements
- Use the component's CSS variables for theming
- Follow the established design patterns
- Maintain accessibility standards
- Use semantic HTML elements

## Styling and Theming

shadcn/ui uses CSS variables for theming. These are defined in your `src/styles/global.css` file.

### Available CSS Variables

- `--background`: Page background
- `--foreground`: Text color
- `--primary`: Primary brand color
- `--primary-foreground`: Text on primary background
- `--muted`: Muted background
- `--muted-foreground`: Muted text
- `--border`: Border color
- `--input`: Input border color
- `--ring`: Focus ring color

### Customizing Colors

To customize the color scheme, modify the CSS variables in `src/styles/global.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  /* ... other variables */
}
```

## Examples

See `src/components/ShadcnExample.astro` for practical examples of using shadcn/ui components in your Astro project.

## Troubleshooting

### Common Issues

1. **Component not found**: Make sure the component is installed with `yarn dlx shadcn@latest add [component]`
2. **Styling issues**: Check that CSS variables are properly defined in `global.css`
3. **Import errors**: Verify the import path uses the `@/` alias

### Getting Help

- Check the [shadcn/ui documentation](https://ui.shadcn.com/)
- Review the component source code in `src/components/ui/`
- Refer to the [Radix UI documentation](https://www.radix-ui.com/) for primitive components 