import { useParams, Navigate } from 'react-router-dom';
import CategoryPage from './CategoryPage';
import { CATEGORY_REGISTRY } from './categories';

export default function CategoryRoute() {
  const { slug } = useParams<{ slug: string }>();
  const category = CATEGORY_REGISTRY.find((c) => c.slug === slug);
  if (!category) return <Navigate to="/recon-connect" replace />;
  return (
    <CategoryPage
      title={category.title}
      icon={category.icon}
      authorizationBanner={category.banner}
      tools={category.tools}
      catalogSlug={category.slug}
    />
  );
}
