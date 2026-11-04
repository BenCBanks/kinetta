"""Allowed activity reactions and projections with the existing block boundary."""
# One server catalog supplies validation, names, emoji, counts and the phone's choices.
CHOICES=(
    ('clap','clapping hands','👏'), ('muscle','flexed biceps','💪'),
    ('fire','fire','🔥'), ('heart','heart','❤️'), ('party','celebration','🎉'),
    ('hands','raised hands','🙌'), ('wow','surprise','😮'), ('bolt','fast','⚡'),
    ('gold','gold medal','🥇'), ('hundred','hundred points','💯'),
    ('run','running','🏃'), ('ride','cycling','🚴'), ('swim','swimming','🏊'),
    ('hike','hiking','🥾'), ('lift','barbell',None), ('mountain','mountain','⛰️'),
)
KINDS=tuple(row[0] for row in CHOICES)
EMOJI={kind:emoji for kind,_,emoji in CHOICES}
LEGACY={'cheer':'clap','strong':'muscle','applause':'fire','laugh':'clap'}

def canonical(kind):
    return LEGACY.get(kind,next((key for key,_,emoji in CHOICES if emoji is not None and emoji==kind),kind))

def visible(viewer):
    return f"NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id={viewer} AND b.blocked=ch.user_id) OR (b.user_id=ch.user_id AND b.blocked={viewer}))"

def columns(viewer):
    # Keys are fixed by the server catalog, never supplied by a request.
    counts=','.join(f"'{kind}',count(*) FILTER(WHERE ch.kind='{kind}')" for kind in KINDS)
    return f"""(SELECT jsonb_build_object({counts})
      FROM cheers ch WHERE ch.activity_id=a.id AND {visible(viewer)}) AS reactions,
      (SELECT ch.kind FROM cheers ch WHERE ch.activity_id=a.id AND ch.user_id={viewer}) AS my_reaction"""

def summary(people):
    return {kind:sum(p['kind']==kind for p in people) for kind in KINDS}
