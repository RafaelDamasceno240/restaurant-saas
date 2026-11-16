'use client';

import { RestaurantProfileView } from '@/components/restaurante/RestaurantProfileView';
import { demoRestaurantProfile } from '@/lib/demo/restaurant-profile';

export default function DemoRestaurantePage() {
  return (
    <RestaurantProfileView
      profile={demoRestaurantProfile}
      logoUrl="/brand/doce-logo.png"
      logoImageClassName="scale-[1.28] object-contain"
      editable
    />
  );
}
