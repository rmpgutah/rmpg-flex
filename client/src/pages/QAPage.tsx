import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { CheckCircle, Star, ThumbsUp, Users } from 'lucide-react';

export default function QAPage() {
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_reviews: 0, avg_review_score: 0, avg_survey_rating: 0, total_surveys: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/qa/reviews').then(r => setReviews(r.data || [])),
      apiFetch<{ total_reviews: number; avg_review_score: number; avg_survey_rating: number; total_surveys: number }>('/qa/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading QA records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="QUALITY ASSURANCE" icon={CheckCircle} />
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={CheckCircle} label="Total Reviews" value={stats.total_reviews} />
        <StatsCard icon={Star} label="Avg Score" value={`${stats.avg_review_score}%`} />
        <StatsCard icon={ThumbsUp} label="Avg Rating" value={`${stats.avg_survey_rating}/5`} />
        <StatsCard icon={Users} label="Surveys" value={stats.total_surveys} />
      </div>
      <DataTable
        columns={[
          { key: 'review_number', label: 'Review #' },
          { key: 'review_type', label: 'Type' },
          { key: 'reviewer_name', label: 'Reviewer' },
          { key: 'score', label: 'Score' },
          { key: 'status', label: 'Status' },
          { key: 'created_at', label: 'Created' },
        ]}
        data={reviews}
        emptyMessage="No QA reviews found"
      />
    </div>
  );
}
