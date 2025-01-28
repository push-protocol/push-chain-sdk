const LandingPageBanner = ({ height }: { height: string }) => {
  return (
    <img
      src={'/RumorBanner.png'}
      style={{
        height: height,
        maxWidth: '100%',
        objectFit: 'cover',
        objectPosition: 'left',
      }}
    />
  );
};

export { LandingPageBanner };
