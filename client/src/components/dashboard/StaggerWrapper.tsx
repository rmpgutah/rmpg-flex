import React from 'react';

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
  const animClass = CLASS_MAP[type];
  const delayIndex = Math.min(Math.max(index, 0), 19);
  return (
    <div className={`${animClass} delay-${delayIndex} ${className}`}>
      {children}
    </div>
  );
}
