import { IconProps, IconWrapper } from 'shared-components';

const Bold: React.FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 10 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M1.125 0.740753V10.7408H6.25C7.69975 10.7408 8.875 9.5655 8.875 8.11575V8.11575C8.875 6.66601 7.69975 5.49075 6.25 5.49075H1.125H5.5C6.81168 5.49075 7.875 4.42743 7.875 3.11575V3.11575C7.875 1.80408 6.81168 0.740753 5.5 0.740753H1.125Z"
            stroke="currentColor"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Bold;
