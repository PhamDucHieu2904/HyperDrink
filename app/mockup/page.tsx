import type { Metadata } from 'next';
import MockupStudio from '@/components/mockup/MockupStudio';

export const metadata: Metadata = {
  title: 'VINUT — 3D Mockup Studio',
  description: 'Create your own VINUT product mockup. Explore packaging, choose a compatible label, adjust the view and download a PNG.',
};

export default function MockupPage() { return <MockupStudio />; }
