import { IconProps, IconWrapper } from 'shared-components';

const Quote: React.FC<IconProps> = (allProps) => {
  const { svgProps: props, ...restProps } = allProps;

  return (
    <IconWrapper
      componentName="ThumbsUp"
      icon={
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 14 10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            d="M1.125 4.99075V0.990753C1.125 0.714611 1.34886 0.490753 1.625 0.490753H5.375C5.65114 0.490753 5.875 0.714611 5.875 0.990753V4.99075C5.875 5.2669 5.65114 5.49075 5.375 5.49075H1.625C1.34886 5.49075 1.125 5.2669 1.125 4.99075Z"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M8.125 4.99075V0.990753C8.125 0.714611 8.34886 0.490753 8.625 0.490753H12.375C12.6511 0.490753 12.875 0.714611 12.875 0.990753V4.99075C12.875 5.2669 12.6511 5.49075 12.375 5.49075H8.625C8.34886 5.49075 8.125 5.2669 8.125 4.99075Z"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M3.375 8.99075C4.04167 8.90742 5.16893 8.40289 5.625 7.49075C5.875 6.99075 5.875 6.24075 5.875 4.99075"
            stroke="currentColor"
            stroke-linecap="round"
          />
          <path
            d="M10.375 8.99075C11.0417 8.90742 12.1689 8.40289 12.625 7.49075C12.875 6.99075 12.875 6.24075 12.875 4.99075"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      }
      {...restProps}
    />
  );
};

export default Quote;
