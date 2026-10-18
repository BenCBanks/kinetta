"""Typed activity reactions. SQL projections preserve the same block boundary as people lists."""
KINDS=('cheer','strong','applause')
LABELS={'cheer':'Cheers','strong':'Strong','applause':'Applause'}

def visible(viewer):
    return f"NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id={viewer} AND b.blocked=ch.user_id) OR (b.user_id=ch.user_id AND b.blocked={viewer}))"

def columns(viewer):
    return f"""(SELECT jsonb_build_object('cheer',count(*) FILTER(WHERE ch.kind='cheer'),
      'strong',count(*) FILTER(WHERE ch.kind='strong'),'applause',count(*) FILTER(WHERE ch.kind='applause'))
      FROM cheers ch WHERE ch.activity_id=a.id AND {visible(viewer)}) AS reactions,
      (SELECT ch.kind FROM cheers ch WHERE ch.activity_id=a.id AND ch.user_id={viewer}) AS my_reaction"""

def summary(people):
    return {kind:sum(p['kind']==kind for p in people) for kind in KINDS}
