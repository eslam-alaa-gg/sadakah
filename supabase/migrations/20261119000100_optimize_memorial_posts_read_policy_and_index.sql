CREATE INDEX IF NOT EXISTS idx_memorial_posts_reviewed_by
ON public.memorial_posts (reviewed_by)
WHERE reviewed_by IS NOT NULL;

DROP POLICY IF EXISTS admin_read_all_posts ON public.memorial_posts;
DROP POLICY IF EXISTS public_read_approved_posts ON public.memorial_posts;

CREATE POLICY public_read_approved_posts
ON public.memorial_posts
FOR SELECT
TO anon
USING (status = 'approved');

CREATE POLICY authenticated_read_approved_or_admin
ON public.memorial_posts
FOR SELECT
TO authenticated
USING (status = 'approved' OR public.is_admin());
