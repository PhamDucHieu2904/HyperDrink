import type { Metadata } from 'next';
import ProductsClient from '@/components/collection/ProductsClient';

export const metadata: Metadata = { title: 'All products — VINUT', description: 'Browse VINUT beverages by drink type, product line, flavor and packaging.' };
export default function ProductsPage() { return <ProductsClient />; }
