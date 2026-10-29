use crate::model::*;
use std::collections::HashSet;
pub fn zones(node: &ZoneNode, area: &Rect, depth: usize) -> Result<Vec<Zone>, String> {
    if depth > 12 {
        return Err("分割の階層が深すぎます".into());
    }
    match node {
        ZoneNode::Zone { id } => Ok(vec![Zone {
            id: id.clone(),
            rect: area.clone(),
        }]),
        ZoneNode::Freeform { zones, .. } => Ok(zones
            .iter()
            .map(|z| Zone {
                id: z.id.clone(),
                rect: Rect {
                    x: area.x + z.rect.x * area.width,
                    y: area.y + z.rect.y * area.height,
                    width: z.rect.width * area.width,
                    height: z.rect.height * area.height,
                },
            })
            .collect()),
        ZoneNode::Split {
            axis,
            ratio,
            first,
            second,
            ..
        } => {
            if !ratio.is_finite()
                || *ratio <= 0.
                || *ratio >= 1.
                || !["x", "y"].contains(&axis.as_str())
            {
                return Err("分割比率が不正です".into());
            }
            let mut a = area.clone();
            let mut b = area.clone();
            if axis == "x" {
                a.width *= ratio;
                b.x += a.width;
                b.width *= 1. - ratio;
            } else {
                a.height *= ratio;
                b.y += a.height;
                b.height *= 1. - ratio;
            }
            let mut result = zones(first, &a, depth + 1)?;
            result.extend(zones(second, &b, depth + 1)?);
            Ok(result)
        }
    }
}
pub fn validate(doc: &LayoutDocument, snapshot: &Snapshot, ps: &[Placement]) -> Result<(), String> {
    if doc.version != 1 || doc.monitors.len() != snapshot.monitors.len() {
        return Err("モニター構成を再取得してください".into());
    }
    let mut monitors = HashSet::new();
    let mut ids = HashSet::new();
    for p in &doc.monitors {
        if !monitors.insert(&p.monitor_id)
            || !snapshot.monitors.iter().any(|m| m.id == p.monitor_id)
        {
            return Err("重複した、または存在しないモニターです".into());
        }
        let zs = zones(
            &p.root,
            &Rect {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            0,
        )?;
        if zs.is_empty() || zs.len() > 9 {
            return Err("領域数は各画面1〜9にしてください".into());
        }
        for z in &zs {
            validate_rect(&z.rect)?;
            if z.id.is_empty() || !ids.insert(z.id.clone()) {
                return Err("領域IDが重複しています".into());
            }
        }
        for placement in ps.iter().filter(|w| w.monitor_id == p.monitor_id) {
            let id = placement
                .zone_id
                .as_ref()
                .ok_or("配置先の領域を指定してください")?;
            let z = zs
                .iter()
                .find(|z| &z.id == id)
                .ok_or("配置先の領域がありません")?;
            if [
                z.rect.x - placement.rect.x,
                z.rect.y - placement.rect.y,
                z.rect.width - placement.rect.width,
                z.rect.height - placement.rect.height,
            ]
            .iter()
            .any(|v| v.abs() > 1e-6)
            {
                return Err("プレビューと領域が一致しません".into());
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_55_45_and_true_stack() {
        let root = ZoneNode::Split {
            id: "s".into(),
            axis: "y".into(),
            ratio: 0.55,
            first: Box::new(ZoneNode::Zone { id: "top".into() }),
            second: Box::new(ZoneNode::Zone {
                id: "bottom".into(),
            }),
        };
        let zs = zones(
            &root,
            &Rect {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            0,
        )
        .unwrap();
        assert!((zs[0].rect.height - 0.55).abs() < 1e-9);
        assert!((zs[1].rect.y - 0.55).abs() < 1e-9);
    }
    #[test]
    fn invalid_split_rejected() {
        let root = ZoneNode::Split {
            id: "s".into(),
            axis: "x".into(),
            ratio: 1.2,
            first: Box::new(ZoneNode::Zone { id: "a".into() }),
            second: Box::new(ZoneNode::Zone { id: "b".into() }),
        };
        assert!(zones(
            &root,
            &Rect {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.
            },
            0
        )
        .is_err());
    }
}
