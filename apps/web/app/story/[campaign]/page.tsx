import { Workspace } from '../../../components/Workspace';

export default async function StoryPage({ params, searchParams }: { params: Promise<{ campaign: string }>; searchParams: Promise<{ as?: string }> }) {
  const { campaign } = await params;
  const { as } = await searchParams;
  return <Workspace campaign={campaign} userId={as ?? 'ilse'} />;
}
