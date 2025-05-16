import React, { HTMLAttributes, ReactNode, forwardRef } from 'react';
import styled from 'styled-components';

export type TransformedHTMLAttributes<T> = Omit<HTMLAttributes<T>, 'style' | 'color'>;

export type ButtonProps = {
    /* Child react nodes rendered by Box */
    children?: ReactNode;
    /* Background color of the button */
    bgColor?: React.CSSProperties['backgroundColor'];
    /* Text color of the button */
    textColor?: React.CSSProperties['color'];
    /* Custom styles to be applied to the button */
    customStyle?: React.CSSProperties;
    /* Sets button as disabled */
    disabled?: boolean;
} & TransformedHTMLAttributes<HTMLButtonElement>;

const StyledButton = styled.button<ButtonProps>`
  /* Common Button CSS */

  align-items: center;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  background: ${(props) => (props.bgColor ? props.bgColor : '#d548ec')};
  color: ${(props) => (props.textColor ? props.textColor : 'rgba(255, 255, 255, 1)')};
  display: flex;
  font-family: FK Grotesk Neu;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
  padding: 16px 24px;
  min-width: 100px;
  width: inherit;
  gap: 4px;
  border:none;
  border-radius: 12px;
  white-space: nowrap;

  /* Custom styles applied via customStyle prop */
  ${(props) => props.customStyle && Object.entries(props.customStyle).map(([key, value]) => `${key}: ${value};`).join('\n')}
`;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            disabled,
            bgColor,
            textColor,
            children,
            ...props
        },
        ref
    ) => (
        <StyledButton
            {...(disabled ? { 'aria-disabled': true } : {})}
            disabled={disabled}
            role="button"
            ref={ref}
            bgColor={bgColor}
            textColor={textColor}
            {...props}
        >
            {children}
        </StyledButton>
    )
);

Button.displayName = 'Button';

export { Button };
