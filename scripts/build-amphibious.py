"""Author ATLAS's reversible car-to-boat and car-to-plane transformations.

Blender --background --python scripts/build-amphibious.py
Reuses the editable expedition car, preserving its original source asset.
Transform_To_Boat, frames 1–121: unlatch, spread the body halves, slide the
wheels out and stow them flat in the hull wells, deploy planing hulls, extend
the bow fairing and jets.
Transform_To_Plane, frames 1–81: telescope the wings out of the body sides,
extend twin tail booms with fins and stabilizer, and push a folding propeller
out through the grille. The wheels stay down as landing gear.
Each transformation is its own NLA track, exported as its own glTF clip.
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'vehicles'
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'atlas-expedition.blend'))
root = bpy.data.objects['Atlas_Expedition']
body = bpy.data.objects['Body']
scene = bpy.context.scene
scene.name = 'Transform_To_Boat'
scene.render.fps = 50
scene.frame_start = 1; scene.frame_end = 121
bpy.context.preferences.filepaths.save_version = 0

def p(v): return Vector((v[0], -v[2], v[1]))
def game(v): return (v.x, v.z, -v.y)
def group(name, loc=(0,0,0), parent=body):
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
    o.parent=parent; o.location=p(loc); return o
def adopt(o, parent):
    matrix=o.matrix_world.copy(); o.parent=parent; o.matrix_world=matrix
def centre(o):
    return sum((o.matrix_world @ Vector(corner) for corner in o.bound_box),Vector())/8
def finish(o, name, parent, mat, bevel=.025):
    o.name=name; o.data.materials.append(bpy.data.materials[mat])
    if bevel:
        mod=o.modifiers.new('Panel edge','BEVEL'); mod.width=bevel; mod.segments=2
        mod=o.modifiers.new('Panel normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    bpy.context.view_layer.update(); adopt(o,parent); return o
def box(name, loc, size, parent, mat='Graphite', bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p(loc)); o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,parent,mat,bevel)
def mesh(name, verts, faces, parent, mat='Paint_Copper'):
    data=bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts],[],faces); data.update()
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    o=bpy.data.objects.new(name,data); scene.collection.objects.link(o)
    return finish(o,name,parent,mat)
def beam(name,a,b,r,parent,mat='Brushed_Alloy'):
    start,end=p(a),p(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=(end-start).length,location=(start+end)/2)
    o=bpy.context.object; o.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
    return finish(o,name,parent,mat,.008)
def ring(name,loc,r,parent,mat='Brushed_Alloy'):
    bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=8,major_radius=r,minor_radius=.045,location=p(loc))
    o=bpy.context.object; o.rotation_euler=(math.pi/2,0,0)
    return finish(o,name,parent,mat,0)
def animate(o, poses):
    base=o.location.copy()
    for frame,translation,rotation,scale in poses:
        o.location=base+p(translation)
        # Game Euler X/Y/Z map to Blender X/Z/-Y.
        o.rotation_euler=(rotation[0],-rotation[2],rotation[1])
        o.scale=scale
        for key in ('location','rotation_euler','scale'): o.keyframe_insert(data_path=key,frame=frame)
    o['transformPart']=True
    scene.frame_set(1)
def push(o, track):
    # One NLA track per transformation; the exporter writes each as a clip.
    data=o.animation_data; action=data.action; action.name=o.name+'|'+track
    nla=data.nla_tracks.new(); nla.name=track
    nla.strips.new(track,1,action); data.action=None
    o['clip']=track
    scene.frame_set(1)
def group_at(name, loc, parent):
    # An empty at a world position (game coordinates), parented without moving.
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o)
    o.location=p(loc); bpy.context.view_layer.update(); adopt(o,parent); return o
def loft(name, rings, parent, mat, caps=True):
    # Closed surface through same-sized cross-section rings (game coordinates).
    n=len(rings[0]); verts=[v for ring in rings for v in ring]; faces=[]
    for j in range(len(rings)-1):
        for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
    if caps: faces+= [tuple(range(n))[::-1], tuple((len(rings)-1)*n+k for k in range(n))]
    return mesh(name,verts,faces,parent,mat)
def material(name, color, emission=None, strength=0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True; bsdf=m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*color,1); bsdf.inputs['Roughness'].default_value=.35
    if emission:
        bsdf.inputs['Emission Color'].default_value=(*emission,1); bsdf.inputs['Emission Strength'].default_value=strength
    return m

left=group('Hull_L',(-.85,.75,0)); right=group('Hull_R',(.85,.75,0))
bow=group('Bow_Extension',(0,1.2,1.1)); stern=group('Stern_Deck',(0,.7,-1.8))
cabin=group('Cabin_Slide',(0,1.5,-.6))
bpy.context.view_layer.update()

# Split the car's actual pressed body shell into independently moving halves.
shell=bpy.data.objects['Pressed aluminium body']
for sign,parent in [(-1,left),(1,right)]:
    o=shell.copy(); o.data=shell.data.copy(); scene.collection.objects.link(o)
    o.name='Split body port' if sign<0 else 'Split body starboard'
    bm=bmesh.new(); bm.from_mesh(o.data)
    cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,
        plane_co=(0,0,0),plane_no=(1,0,0),clear_inner=sign>0,clear_outer=sign<0)
    edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_boundary]
    if edges: bmesh.ops.holes_fill(bm,edges=edges,sides=0)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
    bpy.context.view_layer.update(); adopt(o,parent)
bpy.data.objects.remove(shell,do_unlink=True)

side_parts=('Satin arch flare','Fender fastener','Flexible mud flap','Rock slider','Step tread','Step grip',
    'Side protection strip','Ivory coach stripe','Front marker','Fender cooling slot','Door shut line','Handle recess','Door handle')
front_parts=('Bonnet','Grille','Recessed radiator','Headlamp','Lens fluting','Front signal','Front bumper','Front skid','Skid plate','Winch','Recovery shackle')
cabin_parts=('Cabin frame','Floating roof','Panoramic windshield','Rear glass','Front door glass','Rear quarter glass','B pillar','Beltline',
    'Mirror','Wiper','Rack foot','Roof basket','Basket','Expedition hard case','Case','Strap','Canvas bedroll','Bedroll','Auxiliary')
for o in list(body.children):
    if o.type not in {'MESH','CURVE','FONT'}: continue
    if o.name.startswith(side_parts): adopt(o,left if centre(o).x<0 else right)
    elif o.name.startswith(front_parts): adopt(o,bow)
    elif o.name.startswith(cabin_parts): adopt(o,cabin)
    elif o.name.startswith(('Rear bumper','Rear number','Registration','Tow receiver','Exhaust')): adopt(o,stern)

# Planing hulls are packed inside the car's side sills. They grow out of the
# sills and move with the body halves into a wide, stable catamaran stance.
def hull_ring(hw, chw, keel, chine, gun):
    return [(-hw,gun),(-chw,chine),(0,keel),(chw,chine),(hw,gun),(0,gun+.03)]
HULL=[(-2.78,.58,.50,-.40,-.30,.20),(-2.2,.62,.54,-.50,-.34,.20),(1.2,.62,.54,-.52,-.36,.20),
      (1.9,.58,.46,-.42,-.26,.24),(2.4,.40,.28,-.16,-.02,.32),(2.77,.05,.03,.18,.22,.42)]
for sign,label,parent in [(-1,'L',left),(1,'R',right)]:
    base=Vector((sign*.8,.72,0))
    pod=group_at('Pontoon_'+label,tuple(base),parent)
    rings=[[(base.x+u,base.y+v,base.z+w) for u,v in hull_ring(hw,chw,keel,chine,gun)] for w,hw,chw,keel,chine,gun in HULL]
    loft('Copper planing hull '+label,rings,pod,'Paint_Copper')
    # Graphite rub rails along both gunwales, and deck grips between the wells.
    for side in (-1,1):
        beam('Rub rail '+label,(base.x+side*.6,base.y+.17,base.z-2.7),(base.x+side*.59,base.y+.19,base.z+1.9),.035,pod,'Graphite')
    for zz in (-.6,-.25,.1,.45):
        box('Deck grip '+label,(base.x,base.y+.235,base.z+zz),(.8,.014,.05),pod,'Brushed_Alloy',.003)
    # Dark wells receive the folded wheels (wheel centres sit at z = ±1.37).
    for zz in (1.37-.18,-1.37-.18):
        bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=6,major_radius=.6,minor_radius=.035,location=p((base.x,base.y+.215,base.z+zz)))
        finish(bpy.context.object,'Wheel well rim '+label,pod,'Graphite',0)
    animate(pod,[(1,(0,0,0),(0,0,0),(.35,.2,.28)),(16,(0,0,0),(0,0,0),(.35,.2,.28)),
        (60,(sign*.2,-.10,.1),(0,0,0),(1,1,1)),(121,(sign*.2,-.10,.1),(0,0,0),(1,1,1))])
    push(pod,'Transform_To_Boat')
    for zz in (-1.15,1.15): beam('Hull hydraulic ram '+label,(sign*.38,.68,zz),(sign*1.27,.7,zz),.05,parent)
    animate(parent,[(1,(0,0,0),(0,0,0),(1,1,1)),(22,(sign*.08,.025,0),(0,0,0),(1,1,1)),
        (60,(sign*.58,-.16,.08),(0,0,0),(1,1,1)),(121,(sign*.58,-.16,.08),(0,0,0),(1,1,1))])

# Each wheel slides straight out of its arch, turns flat in free space beside
# the car, then sinks into its hull well. Nothing passes through the body.
for name in ('FL','RL','FR','RR'):
    wheel=bpy.data.objects['Wheel_'+name]; sign=-1 if name.endswith('L') else 1
    fold=group('WheelFold_'+name,parent=root)
    bpy.context.view_layer.update(); adopt(wheel,fold)
    centre_at=wheel.location.copy(); fold.location=centre_at; wheel.location=(0,0,0)
    flat=(0,0,-sign*math.pi/2)
    animate(fold,[(1,(0,0,0),(0,0,0),(1,1,1)),(12,(sign*.12,.04,0),(0,0,0),(1,1,1)),
        (34,(sign*1.15,.40,0),(0,0,0),(1,1,1)),(56,(sign*1.15,.40,0),flat,(1,1,1)),
        (72,(sign*1.15,-.07,0),flat,(1,1,1)),(92,(sign*.54,-.07,0),flat,(1,1,1)),(121,(sign*.54,-.07,0),flat,(1,1,1))])
    push(fold,'Transform_To_Boat')

# A single raked bow fairing slides forward from beneath the front skid and
# closes the gap between the two hull bows; the bumper rides on top of it.
keel=group_at('Keel_Deploy',(0,.42,1.6),body)
BOW=[(0,.95,.72,-.40,-.15,.10),(1.0,.70,.50,-.22,-.02,.11),(1.7,.38,.26,0,.08,.14),(2.2,.06,.04,.18,.20,.24),(2.3,.01,.01,.22,.22,.25)]
rings=[[(u,.42+v,1.6+w) for u,v in hull_ring(hw,chw,keel_y,chine,gun)] for w,hw,chw,keel_y,chine,gun in BOW]
loft('Raked bow fairing',rings,keel,'Paint_Copper')
beam('Bow stem',(0,.42-.40,1.6),(0,.42+.22,1.6+2.3),.03,keel,'Brushed_Alloy')
animate(keel,[(1,(0,0,0),(0,0,0),(.5,.15,.2)),(24,(0,0,0),(0,0,0),(.5,.15,.2)),
    (95,(0,0,.35),(0,0,0),(1,1,1)),(121,(0,0,.35),(0,0,0),(1,1,1))])
push(keel,'Transform_To_Boat')
bridge=group('Bridge_Deck',(0,.8,.3)); bpy.context.view_layer.update()
box('Telescoping sealed bridge',(0,1.23,1.05),(1.5,.12,2.3),bridge)
for zz in (.45,.7,.95,1.2,1.45,1.7): box('Bridge cooling fin',(0,1.297,zz),(1.22,.016,.032),bridge,'Brushed_Alloy',.003)
for sign in (-1,1): beam('Bow extension rail',(sign*.69,1.31,0),(sign*.69,1.31,2.16),.045,bridge)
animate(bridge,[(1,(0,0,0),(0,0,0),(1,.12,.18)),(25,(0,0,0),(0,0,0),(1,.12,.18)),
    (95,(0,0,0),(0,0,0),(1,1,1)),(121,(0,0,0),(0,0,0),(1,1,1))])
push(bridge,'Transform_To_Boat')
animate(bow,[(1,(0,0,0),(0,0,0),(1,1,1)),(25,(0,.12,.1),(-.04,0,0),(1,1,1)),
    (90,(0,-.02,.84),(-.04,0,0),(1.16,1,1.08)),(121,(0,-.02,.84),(-.04,0,0),(1.16,1,1.08))])
push(bow,'Transform_To_Boat')
animate(cabin,[(1,(0,0,0),(0,0,0),(1,1,1)),(34,(0,.08,-.05),(0,0,0),(1,1,1)),
    (95,(0,-.14,-.25),(0,0,0),(1,1,.96)),(121,(0,-.14,-.25),(0,0,0),(1,1,.96))])
push(cabin,'Transform_To_Boat')
animate(stern,[(1,(0,0,0),(0,0,0),(1,1,1)),(55,(0,0,0),(0,0,0),(1,1,1)),
    (108,(0,.02,-.6),(0,0,0),(1.4,1,1)),(121,(0,.02,-.6),(0,0,0),(1.4,1,1))])
push(stern,'Transform_To_Boat')
for sign,label in [(-1,'L'),(1,'R')]:
    jet=group('Jet_'+label,(sign*.59,.48,-1.85)); bpy.context.view_layer.update()
    ring('Water jet nozzle '+label,(sign*.59,.48,-1.85),.23,jet)
    box('Jet housing '+label,(sign*.59,.48,-1.67),(.53,.5,.42),jet)
    for angle in (0,math.pi/3,2*math.pi/3):
        a=(sign*.59+math.cos(angle)*.2,.48+math.sin(angle)*.2,-1.88)
        b=(sign*.59-math.cos(angle)*.2,.48-math.sin(angle)*.2,-1.88)
        beam('Jet rotor '+label,a,b,.018,jet)
    animate(jet,[(1,(0,0,0),(0,0,0),(.08,.08,.08)),(65,(0,0,0),(0,0,0),(.08,.08,.08)),
        (112,(sign*.16,-.03,-.8),(0,0,0),(1,1,1)),(121,(sign*.16,-.03,-.8),(0,0,0),(1,1,1))])
    push(jet,'Transform_To_Boat')
for o in (left,right): push(o,'Transform_To_Boat')

# ---- Transform_To_Plane: frames 1–81 (1.6 s). Every part is stowed inside the
# body at frame 1, so the car keeps its exact silhouette until it transforms.
nav_red=material('Nav_Red',(.55,.05,.04),(1,.08,.05),6)
nav_green=material('Nav_Green',(.05,.45,.15),(.1,1,.35),6)
def airfoil(x, zc, chord, thick, y):
    # Leading edge faces forward (+z); a cambered, thin-trailing-edge section.
    f=[0,.05,.25,.5,.8,1]; d=[0,.7,1,.85,.45,.05]; le=zc+chord*.42
    upper=[(x,y+thick*di*.6,le-fi*chord) for fi,di in zip(f,d)]
    lower=[(x,y-thick*di*.4,le-fi*chord) for fi,di in zip(f[1:-1],d[1:-1])][::-1]
    return upper+lower
WING=[(.03,.98,1.2,1.2,.11,.10),(.06,.96,1.08,1.04,.09,.085),(.05,.94,.95,.72,.07,.05)]
for sign,label in [(-1,'L'),(1,'R')]:
    parent=body; segments=[]
    for k,(x0,x1,c0,c1,t0,t1) in enumerate(WING):
        seg=group_at(f'WingSeg{k+1}_{label}',(sign*(x0+x1)/2,1.12,-.2),parent)
        loft(f'Wing panel {k+1} {label}',[airfoil(sign*x0,-.2,c0,t0,1.12),airfoil(sign*x1,-.2,c1,t1,1.12)],seg,'Paint_Copper')
        if k==2:
            box('Wingtip stripe '+label,(sign*(x1-.12),1.125,-.2+.42*c1-.5*c1),(.16,t1*.9,c1*.92),seg,'Roof_Ivory',.01)
            box('Wingtip light '+label,(sign*(x1+.015),1.12,-.2+.42*c1-.12),(.03,.05,.12),seg,'Nav_Red' if sign>0 else 'Nav_Green',0)
        segments.append(seg); parent=seg
    s1,s2,s3=segments
    animate(s1,[(1,(0,0,0),(0,0,0),(1,1,1)),(6,(sign*.05,0,0),(0,0,0),(1,1,1)),(30,(sign*1.0,0,0),(0,0,0),(1,1,1)),(81,(sign*1.0,0,0),(0,0,0),(1,1,1))])
    animate(s2,[(1,(0,0,0),(0,0,0),(1,1,1)),(14,(0,0,0),(0,0,0),(1,1,1)),(46,(sign*.9,.03,0),(0,0,0),(1,1,1)),(81,(sign*.9,.03,0),(0,0,0),(1,1,1))])
    animate(s3,[(1,(0,0,0),(0,0,0),(1,1,1)),(28,(0,0,0),(0,0,0),(1,1,1)),(62,(sign*.9,.03,0),(0,0,0),(1,1,1)),(81,(sign*.9,.03,0),(0,0,0),(1,1,1))])
    for seg in segments: push(seg,'Transform_To_Plane')
    # A graphite slot marks where each wing leaves the body side.
    box('Wing slot trim '+label,(sign*1.016,1.12,-.2),(.02,.14,1.24),left if sign<0 else right,'Graphite',.004)

# Twin tail booms telescope from the rear corners; fins and stabilizer unfold.
booms={}
for sign,label in [(-1,'L'),(1,'R')]:
    b1=group_at('TailBoom1_'+label,(sign*.92,1.38,-1.4),body)
    beam('Tail boom '+label,(sign*.92,1.38,-.8),(sign*.92,1.38,-2.0),.07,b1,'Brushed_Alloy')
    b2=group_at('TailBoom2_'+label,(sign*.92,1.38,-1.4),b1)
    beam('Tail boom tip '+label,(sign*.92,1.38,-.85),(sign*.92,1.38,-1.95),.055,b2,'Brushed_Alloy')
    fin=group_at('TailFin_'+label,(sign*.92,1.42,-1.75),b2)
    mesh('Tail fin '+label,[(sign*.9,1.42,-1.45),(sign*.94,1.42,-1.45),(sign*.94,1.42,-2.0),(sign*.9,1.42,-2.0),
        (sign*.9,2.42,-1.72),(sign*.94,2.42,-1.72),(sign*.94,2.42,-2.08),(sign*.9,2.42,-2.08)],
        [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],fin,'Paint_Copper')
    box('Fin tip stripe '+label,(sign*.92,2.37,-1.9),(.05,.09,.35),fin,'Roof_Ivory',.008)
    animate(b1,[(1,(0,0,0),(0,0,0),(1,1,1)),(6,(0,0,0),(0,0,0),(1,1,1)),(36,(0,0,-1.25),(0,0,0),(1,1,1)),(81,(0,0,-1.25),(0,0,0),(1,1,1))])
    animate(b2,[(1,(0,0,0),(0,0,0),(1,1,1)),(20,(0,0,0),(0,0,0),(1,1,1)),(50,(0,.08,-1.15),(0,0,0),(1,1,1)),(81,(0,.08,-1.15),(0,0,0),(1,1,1))])
    animate(fin,[(1,(0,0,0),(0,0,0),(1,.04,.3)),(50,(0,0,0),(0,0,0),(1,.04,.3)),(72,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    for o in (b1,b2,fin): push(o,'Transform_To_Plane')
    ring('Tail boom collar '+label,(sign*.92,1.38,-2.05),.09,body,'Graphite')
    booms[label]=b2
stab=group_at('Tail_Stabilizer',(0,1.46,-1.7),booms['L'])
loft('Horizontal stabilizer',[airfoil(-1.42,-1.72,.48,.05,1.46),airfoil(1.42,-1.72,.48,.05,1.46)],stab,'Paint_Copper')
animate(stab,[(1,(0,0,0),(0,0,0),(.02,1,1)),(46,(0,0,0),(0,0,0),(.02,1,1)),(66,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
push(stab,'Transform_To_Plane')

# A three-blade tractor propeller pushes out through the grille. Its blades
# fold back along the shaft when stowed. The game spins 'Propeller' itself.
hub=group_at('Prop_Hub',(0,.98,1.15),body)
bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=.15,radius2=.02,depth=.34,location=p((0,.98,1.15+.17)))
cone=bpy.context.object; cone.rotation_euler=(math.pi/2,0,0); finish(cone,'Propeller spinner',hub,'Brushed_Alloy',0)
beam('Propeller shaft',(0,.98,1.15),(0,.98,-.25),.045,hub,'Graphite')
spinner=group_at('Propeller',(0,.98,1.15),hub)
for k in range(3):
    theta=k*2*math.pi/3
    mount=bpy.data.objects.new(f'BladeMount_{k+1}',None); scene.collection.objects.link(mount)
    mount.matrix_world=Matrix.Translation(p((0,.98,1.15)))@Matrix.Rotation(theta,4,'Y'); adopt(mount,spinner)
    blade=group_at(f'BladeFold_{k+1}',(0,.98,1.15),mount)
    rx,ry=math.sin(theta),math.cos(theta)
    verts=[]
    for rr,cw in ((.06,.07),(.45,.09),(.8,.05)):
        cx,cy=rx*rr,ry*rr; tx,ty=-ry*cw,rx*cw
        verts+=[(cx+tx,.98+cy+ty,1.15+.012),(cx-tx,.98+cy-ty,1.15-.012),(cx-tx,.98+cy-ty,1.15+.012),(cx+tx,.98+cy+ty,1.15-.012)]
    mesh(f'Propeller blade {k+1}',verts,[(0,2,1,3),(8,10,9,11)]+[(j*4+a,j*4+b,(j+1)*4+b,(j+1)*4+a) for j in range(2) for a,b in ((0,2),(2,1),(1,3),(3,0))],blade,'Graphite')
    animate(blade,[(1,(0,0,0),(-1.4,0,0),(1,1,1)),(54,(0,0,0),(-1.4,0,0),(1,1,1)),(78,(0,0,0),(0,0,0),(1,1,1)),(81,(0,0,0),(0,0,0),(1,1,1))])
    push(blade,'Transform_To_Plane')
animate(hub,[(1,(0,0,0),(0,0,0),(1,1,1)),(8,(0,0,0),(0,0,0),(1,1,1)),(36,(0,0,1.6),(0,0,0),(1,1,1)),(81,(0,0,1.6),(0,0,0),(1,1,1))])
push(hub,'Transform_To_Plane')

root['asset']='ATLAS Amphibious / mechanically transforming expedition vehicle'
root['transformDuration']=2.4; root['flightDuration']=1.6
scene.timeline_markers.clear()
for name,frame in [('CAR',1),('UNLATCH',22),('HULLS SPREAD / WHEELS OUT',60),('WHEELS STOWED',92),('BOW EXTENDS',95),('BOAT / JETS LOCK',121)]: scene.timeline_markers.new(name,frame=frame)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'atlas-amphibious.blend'))

# Preserve animated hierarchy; batch only geometry directly owned by each node.
groups=[o for o in [root,*root.children_recursive] if o.type=='EMPTY']
batching=[]
for parent in groups:
    parts=[o for o in list(parent.children) if o.type in {'MESH','CURVE','FONT'}]
    if not parts: continue
    buckets={}; parent['sourceParts']=len(parts)
    for o in parts:
        for mod in o.modifiers:
            if mod.type=='BEVEL': mod.segments=1 if max(o.dimensions)<.35 else 2
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH'); o=bpy.context.object
        buckets.setdefault(o.data.materials[0].name,[]).append(o)
    for mat,objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects: o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); o=bpy.context.object
        o.name=parent.name+'__'+mat
        if mat!='Smoked_Glass' and len(o.data.polygons)>400:
            mod=o.modifiers.new('Game reduction','DECIMATE'); mod.ratio=.48; bpy.ops.object.modifier_apply(modifier=mod.name)
    batching.append({'group':parent.name,'before':len(parts),'after':len(buckets)})
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
for o in root.children_recursive: o.select_set(True)
bpy.context.view_layer.objects.active=root
bpy.ops.export_scene.gltf(filepath=str(OUT/'atlas-amphibious.glb'),export_format='GLB',use_selection=True,export_yup=True,
    export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=True,
    export_animation_mode='NLA_TRACKS',export_frame_step=1)
for o in root.children_recursive:
    if o.type=='MESH': o.data.calc_loop_triangles()
meta={'name':'ATLAS Amphibious','source':'atlas-amphibious.blend','asset':'atlas-amphibious.glb','duration':2.4,'flightDuration':1.6,
    'triangles':sum(len(o.data.loop_triangles) for o in root.children_recursive if o.type=='MESH'),
    'meshes':sum(o.type=='MESH' for o in root.children_recursive),'batching':batching,
    'transformParts':[o.name for o in root.children_recursive if o.get('clip')=='Transform_To_Boat'],
    'flightParts':[o.name for o in root.children_recursive if o.get('clip')=='Transform_To_Plane']}
(OUT/'atlas-amphibious.json').write_text(json.dumps(meta,indent=2)+'\n')
print('AMPHIBIOUS_EXPORT '+json.dumps(meta))
