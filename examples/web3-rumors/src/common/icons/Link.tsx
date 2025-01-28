import { IconProps, IconWrapper } from 'shared-components';

const Link: React.FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 16 13"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M4.36894 6.09592L2.96301 7.06787C1.47511 8.0965 1.38019 10.2613 2.77234 11.4162V11.4162C3.71604 12.1991 5.06585 12.257 6.07319 11.5579L9.01094 9.519"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M11.634 7.49947L12.9922 6.48886C14.4275 5.42083 14.4145 3.257 12.9662 2.14092V2.14092C11.9832 1.38343 10.6295 1.36211 9.65672 2.0888L6.82452 4.20452"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M5.73438 8.51222L10.1033 5.2905"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Link;
