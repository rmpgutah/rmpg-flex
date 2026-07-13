import React, { useState } from 'react';

interface StaggerWrapperProps {
  children: React.ReactNode;
  className?: string;
  index?: number;
  type?: 'fade' | 'slide-left' | 'slide-right' | 'scale';
}

const CLASS_MAP = {
  fade: 'animate-stagger',
  'slide-left': 'animate-stagger-slide-left',
  'slide-right': 'animate-stagger-slide-right',
  scale: 'animate-stagger-scale',
};

export default function StaggerWrapper({
  children,
  className = '',
  index = 0,
  type = 'fade',
}: StaggerWrapperProps) {
  // The stagger-* keyframes use `animation-fill-mode: forwards` on
  // `transform` to hold their final frame. Per spec, an element that is the
  // target of a transform animation is a containing block for
  // position:fixed descendants for as long as the animation stays
  // associated with it — regardless of the resolved value — and
  // `forwards` never lets that association expire. Since this wrapper can
  // hold arbitrary children (tooltips, "..." menus, modals rendered as
  // fixed-position descendants), that would permanently trap any such
  // fixed child inside the card instead of the viewport. Dropping the
  // animation class once it finishes ends the association immediately
  // without affecting the visible transition.
  const [animating, setAnimating] = useState(true);
  const animClass = animating ? CLASS_MAP[type] : '';
  const delayClass = animating ? `delay-${Math.min(Math.max(index, 0), 19)}` : '';
  return (
    <div
      className={`${animClass} ${delayClass} ${className}`}
      onAnimationEnd={() => setAnimating(false)}
    >
      {children}
    </div>
  );
}
