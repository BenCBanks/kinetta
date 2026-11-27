"""Database/account ownership records for optional per-person SQL logins."""
from psycopg import sql


def owner_marker(c, account):
    database = c.execute('SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()').fetchone()[0]
    return f"kinetta-sql-login:v1:{database}:{account['id']}:{account['sql_role']}"


def check_owner(c, account):
    """Fail closed before any cluster-wide role operation; never adopt an existing role.

    Unmarked legacy logins need administrator ownership review. The record is
    written only when provisioning a new login, in the same transaction.
    """
    role = account['sql_role']
    expected = account['login'].lower() + '_sql'
    row = c.execute("""SELECT r.oid,r.rolsuper,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      pg_catalog.shobj_description(r.oid,'pg_authid') FROM pg_catalog.pg_roles r WHERE r.rolname=%s""", (role,)).fetchone()
    if not row:
        return False
    oid,*flags,comment = row
    if role != expected or len(role.encode()) > 63 or any(flags) or comment != owner_marker(c, account):
        raise RuntimeError('SQL login ownership needs administrator review before account deletion or reset')
    # A recorded login can subsequently have been shared with another database,
    # role or service. Check the cluster catalogs again before changing it.
    shared = c.execute("""SELECT 1 FROM pg_catalog.pg_shdepend
      WHERE refclassid='pg_catalog.pg_authid'::regclass AND refobjid=%s
        AND dbid<>(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      UNION ALL SELECT 1 FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
        JOIN pg_catalog.pg_roles u ON u.oid=m.member
        WHERE (m.member=%s AND r.rolname NOT IN ('fit_readers','fit_all_readers'))
           OR (m.roleid=%s AND NOT (u.rolname='fit_app' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option))
      UNION ALL SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE usesysid=%s AND datid<>(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
      LIMIT 1""", (oid,oid,oid,oid)).fetchone()
    if shared:
        raise RuntimeError('Shared SQL login needs administrator review before account deletion or reset')
    return True


def record_owner(c, account):
    c.execute(sql.SQL('COMMENT ON ROLE {} IS {}').format(sql.Identifier(account['sql_role']), sql.Literal(owner_marker(c, account))))
