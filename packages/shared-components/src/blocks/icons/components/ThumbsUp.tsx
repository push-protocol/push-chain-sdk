import { FC } from 'react';
import { IconWrapper } from '../IconWrapper';
import { IconProps } from '../Icons.types';

const ThumbsUp: FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 25 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M11.2172 4.1817L7.93168 10.8026C7.88027 10.9062 7.85352 11.0203 7.85352 11.136V19.1078C7.85352 19.5235 8.19161 19.8599 8.60729 19.8578L18.754 19.8068C19.249 19.8043 19.6669 19.4385 19.735 18.9483L20.9157 10.4458C21.0265 9.64789 20.4067 8.93606 19.6012 8.93606H14.7471C14.3664 8.93606 14.0582 8.62672 14.0596 8.24604L14.0646 6.89109C14.0702 5.36507 12.8346 4.125 11.3086 4.125C11.2698 4.125 11.2344 4.14697 11.2172 4.1817Z"
            fill="currentColor"
          />
          <rect
            x="3.875"
            y="10.875"
            width="3"
            height="9"
            rx="0.75"
            fill="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default ThumbsUp;
