'use client';

import { RestaurantProfileView } from '@/components/restaurante/RestaurantProfileView';
import { demoRestaurantProfile } from '@/lib/demo/restaurant-profile';

export default function DemoRestaurantePage() {
  return <RestaurantProfileView profile={demoRestaurantProfile} editable />;
}
