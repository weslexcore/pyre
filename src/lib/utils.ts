import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Design System Utilities

// Color management
export const pyreColors = {
  black: 'pyre-black',
  creme: 'pyre-creme', 
  red: 'pyre-red',
  blue: 'pyre-blue',
} as const;

// Color combination validation
export function validateColorCombination(colors: string[]): boolean {
  const primaryColors = Object.values(pyreColors);
  const usedColors = colors.filter(c => primaryColors.includes(c));
  return usedColors.length <= 2;
}

// Color separation enforcement
export function enforceColorSeparation(element1: string, element2: string): boolean {
  const conflictingPairs = [
    [pyreColors.blue, pyreColors.red],
    [pyreColors.red, pyreColors.blue]
  ];
  return !conflictingPairs.some(pair => 
    pair.includes(element1) && pair.includes(element2)
  );
}

// Typography utilities
export function getTypographyClass(fontFamily: 'primary' | 'mono', weight: 'regular' | 'semibold' | 'bold'): string {
  if (fontFamily === 'primary') {
    return weight === 'regular' ? 'font-primary-regular' : 'font-primary-semibold';
  }
  return 'font-mono-bold';
}

// Spacing utilities
export function getSpacingScale(multiplier: number): string {
  const baseSpacing = 0.25; // 4px
  return `${baseSpacing * multiplier}rem`;
}

// Border radius utilities
export function getBorderRadius(size: 'sm' | 'md' | 'lg' | 'xl'): string {
  const radiusMap = {
    sm: 'calc(var(--radius) - 4px)',
    md: 'calc(var(--radius) - 2px)', 
    lg: 'var(--radius)',
    xl: 'calc(var(--radius) + 4px)',
  };
  return radiusMap[size];
}

// Component utilities
export function getButtonClasses(variant: 'primary' | 'secondary' | 'outline'): string {
  const baseClasses = 'px-6 py-3 rounded-lg font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const variantClasses = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90 focus:ring-secondary',
    outline: 'border-2 border-button-outline-border text-button-outline-text hover:bg-muted focus:ring-primary',
  };
  
  return cn(baseClasses, variantClasses[variant]);
}

// Accessibility utilities
export function getFocusRingClass(): string {
  return 'focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2';
}

// High contrast utilities
export function getHighContrastClass(): string {
  return 'text-dramatic font-semibold tracking-tight leading-tight';
}

// Design system color utilities - Following 2-color rule
export function getDesignSystemColors(primary: 'background' | 'foreground', secondary?: 'primary' | 'secondary' | 'accent'): string {
  const baseClasses = `bg-${primary} text-${primary === 'background' ? 'foreground' : 'background'}`;
  
  if (secondary) {
    return `${baseClasses} ${secondary === 'primary' ? 'text-primary' : secondary === 'secondary' ? 'text-secondary' : 'text-accent'}`;
  }
  
  return baseClasses;
}

// Responsive utilities
export function getResponsiveClass(base: string, responsive: Record<string, string>): string {
  const classes = [base];
  
  Object.entries(responsive).forEach(([breakpoint, className]) => {
    classes.push(`${breakpoint}:${className}`);
  });
  
  return classes.join(' ');
}

// Animation utilities
export function getAnimationClass(type: 'fadeIn' | 'fadeInUp' | 'slideIn'): string {
  const animationMap = {
    fadeIn: 'animate-fade-in',
    fadeInUp: 'animate-fade-in-up',
    slideIn: 'animate-slide-in',
  };
  return animationMap[type];
}
