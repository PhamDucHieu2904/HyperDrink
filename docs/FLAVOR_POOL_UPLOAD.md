# Adding images to a flavor pool

In **Flavor Data**, open a flavor's **Pool ảnh**, then **Thêm ảnh trang trí**.

1. Choose the object role: fruit, leaf or splash.
2. Choose one or multiple PNG, JPEG or WebP files from the computer.
3. Select **Thêm … ảnh vào pool**. Each file has its own progress and result.

The parent pool supplies the flavor. The server generates the name from the flavor and filename, assigns a unique slug, appends the position to the latest active pool and enables the new image. All metadata and auditing are saved inside a database transaction. Imports remain draft data until publication.

Files are optimized with the existing media pipeline: maximum 20 MB per source image, WebP output, maximum long edge of 1600 pixels, preserved proportions and transparency. Each dialog accepts up to 50 files. A batch has one object role; start another batch for a different role.

Successful files stay saved if another file fails. **Thử lại** processes only the failed/unsaved rows, reuses media already uploaded, and retains the assignment request ID to avoid duplicate pool records after an interrupted response. The dialog stays open to review the result; **Xong** closes it.

Existing image editing shows only role and image. The flavor, ID and ordering remain stable. Order can still be changed with the arrows in the pool list.

The authenticated `POST /api/admin/v1/flavor-pool` accepts only `id`, `flavorId`, `mediaId` and `role`. It validates an active parent flavor and a ready, active image matching that role. Retrying the same assignment returns the original record without changing its revision or adding another audit event. Reusing its ID with different references is a conflict.
