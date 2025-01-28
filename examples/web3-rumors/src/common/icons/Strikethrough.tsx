import { IconProps, IconWrapper } from 'shared-components';

const Strikethrough: React.FC<IconProps> = (allProps) => {
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
            d="M2.75 3.75258C2.75 2.83591 3.3 0.95258 5.5 0.75258C7.7 0.55258 8.75 1.66925 9 2.25258"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M7 5.75259C7.83333 5.91926 9.5 6.60259 9.5 8.00259C9.5 9.75259 8.25 10.7526 6 10.7526C3.75 10.7526 2.5 9.50259 2.5 8.25259"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M0.5 5.75259H11.5"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Strikethrough;
