'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function HeroCarousel() {
  const [images, setImages] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    api.get<{ image_url: string }[]>('/public/carousel')
      .then((r) => {
        const urls = r.data.map((c) => c.image_url).filter(Boolean);
        setImages(urls);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (images.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((i) => (i + 1) % images.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div className="hero-bg-fixed is-gradient">
        <div className="hero-bg-gradient-light dark:hidden absolute inset-0" />
        <div className="hero-bg-gradient-dark hidden dark:block absolute inset-0" />
      </div>
    );
  }

  return (
    <div className="hero-bg-fixed">
      {images.map((url, i) => (
        <div
          key={url}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{ opacity: i === current ? 1 : 0 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="w-full h-full object-cover" />
        </div>
      ))}
      <div className="carousel-overlay" />
    </div>
  );
}
