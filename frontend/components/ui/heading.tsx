import * as React from "react";

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level: 1 | 2 | 3;
}

const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(({ level, ...props }, ref) => {
  if (level === 1) {
    return <h1 ref={ref} {...props} />;
  }

  if (level === 2) {
    return <h2 ref={ref} {...props} />;
  }

  return <h3 ref={ref} {...props} />;
});
Heading.displayName = "Heading";

export { Heading };