// TypeScript interfaces for Pyre design system components

export interface ServiceCardProps {
  title: string;
  description: string;
  image: string;
  symbol: string;
  count: string;
}

export interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

export interface FormFieldProps {
  label: string;
  name: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  required?: boolean;
  placeholder?: string;
  error?: string;
  description?: string;
}

export interface ColorComboProps {
  primary: 'pyre-black' | 'pyre-creme' | 'pyre-red' | 'pyre-blue';
  secondary: 'pyre-black' | 'pyre-creme' | 'pyre-red' | 'pyre-blue';
}

export interface TypographyProps {
  fontFamily: 'primary' | 'mono';
  weight: 'regular' | 'semibold' | 'bold';
  size: 'scale-1' | 'scale-2' | 'scale-3' | 'scale-4' | 'scale-5' | 'scale-6';
  lineHeight?: 'tight' | 'normal' | 'relaxed';
  letterSpacing?: 'tight' | 'normal' | 'loose' | 'variable';
}

export interface SymbolProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
}

// Design system configuration types
export interface DesignSystemConfig {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    neutral: string;
  };
  typography: {
    fontFamilies: Record<string, string>;
    fontWeights: Record<string, number>;
    lineHeights: Record<string, number>;
  };
  spacing: {
    scale: number[];
    container: Record<string, string>;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
} 