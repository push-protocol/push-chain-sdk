import { IconProps, IconWrapper } from 'shared-components';

const Italic: React.FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M4.625 0.740753H11.5"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M0.5 10.7408H7.375"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M3.9375 10.7408L8.0625 0.740753"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Italic;
