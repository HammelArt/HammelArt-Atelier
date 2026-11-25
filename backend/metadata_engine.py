"""
core/metadata_engine.py
=======================
Standalone Universal Metadata & Graph Unrolling Engine for HammelArt Atelier.

Zero hard dependencies on external tools (works out of the box on images & videos).

Supports:
1. ComfyUI API Prompt Graphs & Full Workflows (including Subgraphs, BasicGuider, FluxGuidance,
   SamplerCustomAdvanced, KSampler, MiniMaxH3ImageToVideo / ReferenceToVideo, WanVideo,
   HammelartPromptCenter, HammelartArtDirectorV2, HammelartModelBatcher).
2. Direct PNG/WebP text chunks (`hammelart_prompt`, `hammelart_parameters`, `parameters`).
3. A1111 / Civitai parameter strings.
4. Video containers (`.mp4`, `.webm`, `.mov`) via `ffprobe` stream & format tag inspection
   (with automatic `cv2.VideoCapture` fallback for dimensions, FPS, and duration when `ffprobe` is absent).
"""

from __future__ import annotations

import io
import json
import math
import os
import re
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from PIL import Image


def _sanitize_json_graph(obj: Any) -> Any:
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _sanitize_json_graph(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json_graph(v) for v in obj]
    return obj

TAG_DICTIONARY = [
    # Traditional & Digital Fine Art
    "oil-painting", "watercolor", "gouache", "acrylic", "impasto", "ink", "sketch",
    "charcoal", "lineart", "pastel", "woodcut", "stained-glass", "origami", "papercraft",
    "concept-art", "digital-painting", "matte-painting", "illustration", "surrealism",
    "abstract", "minimalist", "art-nouveau", "art-deco", "baroque", "impressionism",
    "pop-art", "ukiyo-e", "gothic", "vintage", "noir",
    # Stylized, Anime & 3D
    "anime", "manga", "cel-shaded", "chibi", "mecha", "pixel-art", "isometric",
    "voxel", "low-poly", "3d-render", "octane", "claymation", "diorama", "miniature",
    # Genres, Worldbuilding & Environments
    "cyberpunk", "steampunk", "scifi", "fantasy", "dystopian", "architecture",
    "landscape", "cosmos", "space", "forest", "ocean", "desert", "mountain",
    "ruins", "castle", "cityscape", "urban", "cyber",
    # Characters, Fashion & Subjects
    "portrait", "character", "fashion", "armor", "jewelry", "glasses", "tattoo",
    "eyes", "creature", "dragon", "robot", "android", "spaceship", "vehicle", "flowers",
    # Photography, Camera & Lighting
    "photorealistic", "cinematic", "editorial", "candid", "macro", "closeup",
    "wide-angle", "low-angle", "aerial", "silhouette", "bokeh", "film-grain",
    "monochrome", "smartphone", "35mm", "85mm", "daylight", "golden-hour",
    "blue-hour", "neon", "moonlight", "candlelight", "volumetric", "chiaroscuro",
    "rim-light", "bioluminescent", "studio-lighting", "ethereal", "fog", "rain",
]


def _build_tag_regex() -> re.Pattern:
    words = list(TAG_DICTIONARY)
    custom_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "userdata", "custom_tags.json")
    )
    if os.path.isfile(custom_path):
        try:
            with open(custom_path, "r", encoding="utf-8") as f:
                extra = json.load(f)
            if isinstance(extra, list):
                for item in extra:
                    if isinstance(item, str) and item.strip():
                        words.append(item.strip().lower())
        except Exception:
            pass
    # Longer keywords first so compound terms match cleanly
    uniq = sorted(set(words), key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(re.escape(k) for k in uniq) + r")\b", re.IGNORECASE)


_TAG_REGEX = _build_tag_regex()


def extract_tags_from_text(text: str, extra_tags_str: str = "") -> List[str]:
    tags = set()
    if extra_tags_str:
        for t in extra_tags_str.split(","):
            clean = t.strip().lower().replace('"', "")
            if clean:
                tags.add(clean)
    if text:
        for match in _TAG_REGEX.findall(text.lower()):
            tags.add(match.lower())
    return sorted(tags)


def detect_model_dialect(model_name: str, sampler_name: str = "", prompt_dict: Optional[Dict[str, Any]] = None) -> str:
    m_low = (model_name or "").lower()
    s_low = (sampler_name or "").lower()
    if any(k in m_low for k in ("minimax", "wan", "hunyuan", "ltx", "mochi", "cogvideo")):
        return "Video / Cinema"
    if any(k in m_low for k in ("moss", "kromoss", "krast")):
        return "MOSS"
    if any(k in m_low for k in ("krea", "flux", "schnell")):
        return "Flux / Krea"
    if any(k in m_low for k in ("qwen", "vl")):
        return "Qwen-VL"
    if any(k in m_low for k in ("xl", "sdxl", "pony", "illustrious")):
        return "SDXL"
    if any(k in m_low for k in ("sd15", "v1-5", "1.5")):
        return "SD 1.5"
    if "taylor" in s_low or "er_sde" in s_low:
        return "Flow / SDE"
    if prompt_dict and isinstance(prompt_dict, dict):
        ctypes = " ".join(str(v.get("class_type", "")) for v in prompt_dict.values() if isinstance(v, dict)).lower()
        if "minimax" in ctypes or "wan" in ctypes:
            return "Video / Cinema"
        if "flux" in ctypes:
            return "Flux / Krea"
    return "Custom" if model_name and model_name != "Unknown" else "Standard"


def _parse_json_input(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _resolve_switch_link(inputs: Dict[str, Any]) -> Any:
    raw_sel = inputs.get("SwitchState", inputs.get("select", inputs.get("index", 1)))
    try:
        idx = int(str(raw_sel).strip())
    except Exception:
        idx = 1
    chosen = inputs.get(f"input_{idx}")
    if isinstance(chosen, list) or (isinstance(chosen, str) and chosen.strip()):
        return chosen
    for key in [*(f"input_{n}" for n in range(1, 9)), "on_true", "on_false", "true", "false"]:
        cand = inputs.get(key)
        if isinstance(cand, list) or (isinstance(cand, str) and cand.strip()):
            return cand
    return None


def _resolve_pixaroma_text_node(
    ctype: str,
    inputs: Dict[str, Any],
    trace_fn: Any,
    prompt: Dict[str, Any],
    visited: set,
    depth: int,
) -> Optional[str]:
    if "PauseState" in inputs or "PixaromaPauseText" in ctype:
        pst = _parse_json_input(inputs.get("PauseState"))
        pause_text = str(pst.get("text") or "").strip()
        mode = str(pst.get("mode") or "pass").strip().lower()
        if mode != "pass" and pause_text:
            return pause_text
        t_link = inputs.get("text")
        if isinstance(t_link, list) and len(t_link) >= 1:
            traced = trace_fn(str(t_link[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(t_link, str) and t_link.strip():
            return t_link.strip()
        return pause_text

    if "PromptState" in inputs or "PixaromaPrompt" in ctype:
        pst = _parse_json_input(inputs.get("PromptState"))
        local_text = str(pst.get("text") or "").strip()
        order = str(pst.get("order") or "wired").strip().lower()
        sep = str(pst.get("sep") if pst.get("sep") is not None else ", ")
        wired_text = ""
        t_in = inputs.get("text_in")
        if isinstance(t_in, list) and len(t_in) >= 1:
            wired_text = trace_fn(str(t_in[0]), prompt, visited, depth + 1)
        elif isinstance(t_in, str) and t_in.strip():
            wired_text = t_in.strip()
        parts = [local_text, wired_text] if order == "mine" else [wired_text, local_text]
        parts = [p for p in parts if p]
        return sep.join(parts) if len(parts) > 1 else (parts[0] if parts else "")

    if "AIPromptState" in inputs or "PixaromaAIPrompt" in ctype:
        ast = _parse_json_input(inputs.get("AIPromptState"))
        ai_txt = str(ast.get("text") or ast.get("prompt") or "").strip()
        if ai_txt:
            return ai_txt

    if "SwitchState" in inputs or "Switch" in ctype:
        sw = _resolve_switch_link(inputs)
        if isinstance(sw, list) and len(sw) >= 1:
            return trace_fn(str(sw[0]), prompt, visited, depth + 1)
        if isinstance(sw, str) and sw.strip():
            return sw.strip()

    return None


def _trace_text_from_node(node_id: str, prompt: Dict[str, Any], visited: Optional[set] = None, depth: int = 0) -> str:
    if visited is None:
        visited = set()
    if depth > 14 or node_id in visited:
        return ""
    visited.add(node_id)
    node = prompt.get(str(node_id))
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    # 1. HammelartPromptCenter / PromptCenter
    if "PromptCenter" in ctype:
        payload_str = inputs.get("payload", "")
        p_data = {}
        if payload_str:
            try:
                p_data = json.loads(payload_str) if isinstance(payload_str, str) else payload_str
            except Exception:
                p_data = {}
        is_override = bool(p_data.get("override_active", False)) if isinstance(p_data, dict) else False
        p_pos = str(p_data.get("positive", p_data.get("prompt", p_data.get("text", "")))).strip() if isinstance(p_data, dict) else ""
        if is_override and p_pos:
            return p_pos
        pos_in = inputs.get("positive_in")
        if isinstance(pos_in, list) and len(pos_in) >= 1:
            traced = _trace_text_from_node(str(pos_in[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(pos_in, str) and pos_in.strip():
            return pos_in.strip()
        if p_pos:
            return p_pos

    # 2. HammelartArtDirectorV2
    if "ArtDirector" in ctype:
        for k in ("positive_prompt", "concept"):
            val = str(inputs.get(k) or "").strip()
            if val:
                return val

    # 2.5 Pixaroma Prompt / Switch / PauseText / AIPrompt nodes
    pixa_res = _resolve_pixaroma_text_node(ctype, inputs, _trace_text_from_node, prompt, visited, depth)
    if pixa_res is not None:
        return pixa_res

    # 3. MiniMax / Wan / Video Text Encoders & ImageToVideo nodes
    if any(k in ctype for k in ("MiniMax", "Wan", "Video", "CLIPTextEncode")):
        for key in ("prompt", "text", "positive_prompt", "caption"):
            t = inputs.get(key)
            if isinstance(t, list) and len(t) >= 1:
                traced = _trace_text_from_node(str(t[0]), prompt, visited, depth + 1)
                if traced:
                    return traced
            elif isinstance(t, str) and t.strip():
                return t.strip()

    # 4. Generic string/text nodes
    for key in ("text", "prompt", "string", "value", "text_positive", "positive"):
        val = inputs.get(key)
        if isinstance(val, list) and len(val) >= 1:
            traced = _trace_text_from_node(str(val[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(val, str) and val.strip():
            return val.strip()

    return ""


def _trace_negative_text_from_node(node_id: str, prompt: Dict[str, Any], visited: Optional[set] = None, depth: int = 0) -> str:
    if visited is None:
        visited = set()
    if depth > 14 or node_id in visited:
        return ""
    visited.add(node_id)
    node = prompt.get(str(node_id))
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    if "ConditioningZeroOut" in ctype:
        return ""

    if "PromptCenter" in ctype:
        payload_str = inputs.get("payload", "")
        p_data = {}
        if payload_str:
            try:
                p_data = json.loads(payload_str) if isinstance(payload_str, str) else payload_str
            except Exception:
                p_data = {}
        p_neg = str(p_data.get("negative") or "").strip() if isinstance(p_data, dict) else ""
        neg_in = inputs.get("negative_in")
        if isinstance(neg_in, list) and len(neg_in) >= 1:
            traced = _trace_negative_text_from_node(str(neg_in[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(neg_in, str) and neg_in.strip():
            return neg_in.strip()
        if p_neg:
            return p_neg

    if "ArtDirector" in ctype:
        ad_neg = str(inputs.get("negative_prompt") or "").strip()
        if ad_neg:
            return ad_neg

    pixa_res = _resolve_pixaroma_text_node(ctype, inputs, _trace_negative_text_from_node, prompt, visited, depth)
    if pixa_res is not None:
        return pixa_res

    for key in ("negative_prompt", "text_negative", "negative", "text", "string", "value"):
        val = inputs.get(key)
        if isinstance(val, list) and len(val) >= 1:
            traced = _trace_negative_text_from_node(str(val[0]), prompt, visited, depth + 1)
            if traced:
                return traced
        elif isinstance(val, str) and val.strip():
            return val.strip()

    return ""


def _trace_conditioning_upstream(cond_link: Any, prompt: Dict[str, Any], is_negative: bool = False, depth: int = 0) -> str:
    if depth > 14 or not isinstance(cond_link, list) or len(cond_link) < 1:
        return ""

    node_id = str(cond_link[0])
    node = prompt.get(node_id)
    if not isinstance(node, dict):
        return ""

    ctype = str(node.get("class_type", ""))
    inputs = node.get("inputs", {})
    if not isinstance(inputs, dict):
        return ""

    if "ConditioningZeroOut" in ctype:
        return ""

    # Guider nodes (CFGGuider, BasicGuider, DualCFGGuider)
    if "Guider" in ctype:
        if is_negative:
            if "negative" in inputs:
                return _trace_conditioning_upstream(inputs["negative"], prompt, True, depth + 1)
            return ""
        else:
            for k in ("positive", "conditioning", "cond"):
                if k in inputs:
                    res = _trace_conditioning_upstream(inputs[k], prompt, False, depth + 1)
                    if res:
                        return res

    # Conditioning modifiers
    for c_key in ("conditioning", "conditioning_to", "conditioning_from", "conditioning_1", "positive"):
        if c_key in inputs and isinstance(inputs[c_key], list):
            res = _trace_conditioning_upstream(inputs[c_key], prompt, is_negative, depth + 1)
            if res:
                return res

    fn = _trace_negative_text_from_node if is_negative else _trace_text_from_node
    return fn(node_id, prompt, set(), 0)


_EXT_RE = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|gguf)$", re.IGNORECASE)


def _asset_basename(raw: Any) -> str:
    txt = str(raw or "").strip()
    if not txt or txt.lower() in ("unknown", "none", "null"):
        return ""
    return os.path.basename(txt.replace("\\", "/"))


def _clean_asset_name(raw: Any) -> str:
    base = _asset_basename(raw)
    if not base:
        return "Unknown"
    return _EXT_RE.sub("", base)


def _format_num(val: Any, digits: int = 2) -> Any:
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        return "Unknown"
    rounded = round(float(val), digits)
    return int(rounded) if rounded.is_integer() else rounded


def _resolve_seed_val(val: Any, prompt: Dict[str, Any], depth: int = 0) -> str:
    if depth > 6 or val is None:
        return "Unknown"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return str(int(val))
    if isinstance(val, str):
        txt = val.strip()
        if txt and txt.lstrip("-").isdigit():
            return txt
        return "Unknown"
    if isinstance(val, list) and len(val) >= 1:
        src = prompt.get(str(val[0]))
        if isinstance(src, dict):
            s_in = src.get("inputs", {}) if isinstance(src.get("inputs"), dict) else {}
            for k in ("noise_seed", "seed", "seed_a", "value", "val", "int", "number"):
                if k in s_in:
                    r = _resolve_seed_val(s_in[k], prompt, depth + 1)
                    if r != "Unknown":
                        return r
    return "Unknown"


def _resolve_scalar_num(val: Any, prompt: Dict[str, Any], depth: int = 0) -> Any:
    if depth > 6 or val is None:
        return "Unknown"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return val
    if isinstance(val, str):
        try:
            return float(val.strip())
        except Exception:
            return "Unknown"
    if isinstance(val, list) and len(val) >= 1:
        src = prompt.get(str(val[0]))
        if isinstance(src, dict):
            s_in = src.get("inputs", {}) if isinstance(src.get("inputs"), dict) else {}
            for k in ("value", "val", "number", "float", "int", "guidance", "denoise", "cfg", "steps", "shift"):
                if k in s_in:
                    r = _resolve_scalar_num(s_in[k], prompt, depth + 1)
                    if r != "Unknown":
                        return r
    return "Unknown"


def _find_active_decode_and_sampler(prompt: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[str, Dict[str, Any]]]]:
    # 1. Trace backwards from SaveImage / ImageCurator / VideoCombine through Decode
    for _, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type", ""))
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        if any(k in ctype for k in ("ImageCurator", "SaveImage", "PixaromaSaveImage", "VideoCombine", "SaveVideo")):
            img_link = inputs.get("images") or inputs.get("video")
            if isinstance(img_link, list) and len(img_link) >= 1:
                dec_node = prompt.get(str(img_link[0]), {})
                if isinstance(dec_node, dict):
                    d_inputs = dec_node.get("inputs", {})
                    samples_link = d_inputs.get("samples") or d_inputs.get("latent")
                    if isinstance(samples_link, list) and len(samples_link) >= 1:
                        s_id = str(samples_link[0])
                        s_node = prompt.get(s_id)
                        if isinstance(s_node, dict):
                            return (dec_node, (s_id, s_node))

    # 2. Fallback scan for decode / sampler nodes
    found_dec: Optional[Dict[str, Any]] = None
    found_sampler: Optional[Tuple[str, Dict[str, Any]]] = None
    for node_id, node in prompt.items():
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type", ""))
        if found_dec is None and "VAEDecode" in ctype:
            found_dec = node
        if found_sampler is None and any(k in ctype for k in ("KSampler", "SamplerCustom", "ClownsharK", "SamplerER")):
            found_sampler = (node_id, node)
    return (found_dec, found_sampler)


def _find_active_sampler_node(prompt: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
    _, sampler_pair = _find_active_decode_and_sampler(prompt)
    return sampler_pair


def _append_lora_entry(out: List[Dict[str, Any]], raw_lora: Any, sm: float, sc: float) -> None:
    base = _asset_basename(raw_lora)
    if not base:
        return
    if sm == 0.0 and sc == 0.0:
        return
    out.append(
        {
            "name": _clean_asset_name(base),
            "filename": base,
            "strength": round(float(sm), 2),
            "strength_clip": round(float(sc), 2),
        }
    )


def _extract_loras_from_node(up_ctype: str, up_in: Dict[str, Any]) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    # 1. HammelartLoraLoadout (mirrors solo -> active -> bypassed rules in lora_loadout.py)
    if "LoraLoadout" in up_ctype:
        try:
            data = json.loads(up_in.get("payload", "{}")) if isinstance(up_in.get("payload"), str) else up_in.get("payload", {})
            if isinstance(data, dict) and not data.get("bypassed", False):
                lora_list = [x for x in (data.get("loras") or []) if isinstance(x, dict) and x.get("lora")]
                has_solo = any(bool(item.get("solo", False)) for item in lora_list)
                active_items = [
                    item for item in lora_list
                    if (bool(item.get("solo", False)) if has_solo else bool(item.get("active", True)))
                ]
                for item in active_items:
                    sm = float(item.get("strength_model", item.get("strength", 1.0)))
                    sc = float(item.get("strength_clip", item.get("strength", sm)))
                    _append_lora_entry(found, item.get("lora"), sm, sc)
        except Exception:
            pass
        return found

    # 1.5 Pixaroma LoraLoader (LoraLoaderState JSON: {"loras": [{"name": "...", "on": true, "sm": 1, "sc": 1}, ...]})
    if "LoraLoaderState" in up_in or "PixaromaLora" in up_ctype:
        try:
            data = _parse_json_input(up_in.get("LoraLoaderState"))
            for item in (data.get("loras") or []):
                if not isinstance(item, dict) or item.get("on") is not True:
                    continue
                raw_name = item.get("name") or item.get("lora")
                if not raw_name:
                    continue
                sm = float(item.get("sm", item.get("strength_model", item.get("strength", 1.0))))
                sc = float(item.get("sc", item.get("strength_clip", sm)))
                _append_lora_entry(found, raw_name, sm, sc)
        except Exception:
            pass
        return found

    # 2. rgthree Power Lora Loader (inputs like lora_1: {"on": true, "lora": "...", "strength": 0.8})
    rg_keys = [
        k for k, v in up_in.items()
        if isinstance(v, dict) and "lora" in v and ("on" in v or k.lower().startswith("lora"))
    ]
    if rg_keys:
        for k in sorted(rg_keys, key=lambda x: [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", x)]):
            val = up_in[k]
            if val.get("on", False) is True and val.get("lora"):
                sm = float(val.get("strength", 1.0))
                sc = float(val.get("strengthTwo", sm) if val.get("strengthTwo") is not None else sm)
                _append_lora_entry(found, val.get("lora"), sm, sc)
        return found

    # 3. Standard ComfyUI LoraLoader / LoraLoaderModelOnly
    if "lora_name" in up_in:
        sm = float(up_in.get("strength_model", up_in.get("strength", 1.0)))
        sc = float(up_in.get("strength_clip", sm))
        _append_lora_entry(found, up_in.get("lora_name"), sm, sc)

    return found


def _trace_model_chain(start_link: Any, prompt: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], Any]:
    model_name = "Unknown"
    loras_rev: List[Dict[str, Any]] = []
    shift_val: Any = "Unknown"
    visited: set = set()
    curr_link = start_link

    for _ in range(28):
        if not (isinstance(curr_link, list) and len(curr_link) >= 1):
            break
        nid = str(curr_link[0])
        if nid in visited:
            break
        visited.add(nid)

        up_node = prompt.get(nid)
        if not isinstance(up_node, dict):
            break
        up_ctype = str(up_node.get("class_type", ""))
        up_in = up_node.get("inputs", {})
        if not isinstance(up_in, dict):
            break

        node_loras = _extract_loras_from_node(up_ctype, up_in)
        if node_loras:
            # Keep node internal top-to-bottom order when reversing outer chain
            loras_rev.extend(reversed(node_loras))

        if shift_val == "Unknown" and "ModelSampling" in up_ctype and "shift" in up_in:
            resolved_shift = _resolve_scalar_num(up_in.get("shift"), prompt)
            if resolved_shift != "Unknown":
                shift_val = _format_num(resolved_shift, 2)

        if "ModelBatcher" in up_ctype:
            try:
                mb_data = json.loads(up_in.get("payload", "{}"))
                act = [m["model"] for m in mb_data.get("batch_models", []) if m.get("active") and m.get("model")]
                if act:
                    model_name = act[0]
            except Exception:
                pass
            break
        if any(k in up_ctype for k in ("CheckpointLoader", "UNETLoader", "DiffusionModelLoader", "UnetLoaderGGUF")):
            model_name = str(up_in.get("ckpt_name", up_in.get("unet_name", up_in.get("model_name", model_name))))
            break

        next_link = up_in.get("model") or up_in.get("model_1") or up_in.get("ckpt")
        if next_link:
            curr_link = next_link
        else:
            break

    loras = list(reversed(loras_rev))
    return model_name, loras, shift_val


def _trace_vae_upstream(dec_node: Optional[Dict[str, Any]], prompt: Dict[str, Any]) -> Tuple[str, str]:
    if not isinstance(dec_node, dict):
        return "Unknown", "Unknown"
    d_in = dec_node.get("inputs", {})
    if not isinstance(d_in, dict):
        return "Unknown", "Unknown"
    curr_link = d_in.get("vae")
    visited: set = set()
    for _ in range(10):
        if not (isinstance(curr_link, list) and len(curr_link) >= 1):
            break
        nid = str(curr_link[0])
        if nid in visited:
            break
        visited.add(nid)
        up = prompt.get(nid)
        if not isinstance(up, dict):
            break
        ctype = str(up.get("class_type", ""))
        u_in = up.get("inputs", {}) if isinstance(up.get("inputs"), dict) else {}
        if "VAELoader" in ctype or "vae_name" in u_in:
            raw = _asset_basename(u_in.get("vae_name"))
            if raw:
                return _clean_asset_name(raw), raw
        if any(k in ctype for k in ("CheckpointLoader", "ModelBatcher")):
            raw = _asset_basename(u_in.get("ckpt_name"))
            if raw:
                return f"{_clean_asset_name(raw)} (ckpt)", raw
        curr_link = u_in.get("vae") or u_in.get("model")
    return "Unknown", "Unknown"


def _trace_clip_from_link(clip_link: Any, prompt: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    curr = clip_link
    visited: set = set()
    for _ in range(16):
        if not (isinstance(curr, list) and len(curr) >= 1):
            break
        nid = str(curr[0])
        if nid in visited:
            break
        visited.add(nid)
        up = prompt.get(nid)
        if not isinstance(up, dict):
            break
        ctype = str(up.get("class_type", ""))
        u_in = up.get("inputs", {}) if isinstance(up.get("inputs"), dict) else {}

        names_raw: List[str] = []
        for k in ("clip_name", "clip_name1", "clip_name2", "clip_name3", "clip_name4", "clip_1", "clip_2"):
            if k in u_in and isinstance(u_in[k], str):
                b = _asset_basename(u_in[k])
                if b and b not in names_raw:
                    names_raw.append(b)
        if names_raw:
            return [_clean_asset_name(n) for n in names_raw], names_raw

        if "CheckpointLoader" in ctype:
            raw = _asset_basename(u_in.get("ckpt_name"))
            if raw:
                return [f"{_clean_asset_name(raw)} (ckpt)"], [raw]
            break

        curr = u_in.get("clip") or u_in.get("clip_1")
    return [], []


def _trace_cond_extras(cond_link: Any, prompt: Dict[str, Any]) -> Tuple[Any, List[str], List[str]]:
    """Traces guidance (e.g. FluxGuidance) and upstream CLIP filenames along the active conditioning branch."""
    guidance_val: Any = "Unknown"
    clips_short: List[str] = []
    clips_raw: List[str] = []
    queue = [cond_link]
    visited: set = set()

    for _ in range(18):
        if not queue:
            break
        link = queue.pop(0)
        if not (isinstance(link, list) and len(link) >= 1):
            continue
        nid = str(link[0])
        if nid in visited:
            continue
        visited.add(nid)

        node = prompt.get(nid)
        if not isinstance(node, dict):
            continue
        ctype = str(node.get("class_type", ""))
        n_in = node.get("inputs", {}) if isinstance(node.get("inputs"), dict) else {}

        if guidance_val == "Unknown" and "guidance" in n_in:
            gv = _resolve_scalar_num(n_in.get("guidance"), prompt)
            if gv != "Unknown":
                guidance_val = _format_num(gv, 2)

        if not clips_short and "clip" in n_in:
            cs, cr = _trace_clip_from_link(n_in.get("clip"), prompt)
            if cs:
                clips_short, clips_raw = cs, cr

        for k in ("conditioning", "positive", "conditioning_1", "conditioning_2", "conditioning_from", "conditioning_to", "guider"):
            if isinstance(n_in.get(k), list):
                queue.append(n_in[k])

        if guidance_val != "Unknown" and clips_short:
            break

    return guidance_val, clips_short, clips_raw


def parse_comfy_graph(prompt: Any) -> Dict[str, Any]:
    pos_prompt = ""
    neg_prompt = ""
    seed: Any = "Unknown"
    steps: Any = "Unknown"
    sampler: Any = "Unknown"
    scheduler: Any = "Unknown"
    cfg: Any = "Unknown"
    guidance: Any = "Unknown"
    denoise: Any = "Unknown"
    shift: Any = "Unknown"
    model_name = "Unknown"
    vae_short = "Unknown"
    vae_raw = "Unknown"
    clips: List[str] = []
    clips_raw: List[str] = []
    loras: List[Dict[str, Any]] = []

    if isinstance(prompt, str):
        try:
            prompt = json.loads(prompt)
        except Exception:
            prompt = None

    if not isinstance(prompt, dict):
        return {
            "positive": "",
            "negative": "",
            "seed": "Unknown",
            "steps": "Unknown",
            "sampler": "Unknown",
            "scheduler": "Unknown",
            "cfg": "Unknown",
            "guidance": "Unknown",
            "denoise": "Unknown",
            "shift": "Unknown",
            "model": "Unknown",
            "vae_short": "Unknown",
            "vae_raw": "Unknown",
            "clips": [],
            "clips_raw": [],
            "loras": [],
        }

    dec_node, active_sampler = _find_active_decode_and_sampler(prompt)
    vae_short, vae_raw = _trace_vae_upstream(dec_node, prompt)

    if active_sampler:
        _, s_node = active_sampler
        s_inputs = s_node.get("inputs", {}) if isinstance(s_node, dict) else {}

        pos_wire = s_inputs.get("positive") if "positive" in s_inputs else s_inputs.get("guider")
        neg_wire = s_inputs.get("negative") if "negative" in s_inputs else s_inputs.get("guider")
        if pos_wire:
            pos_prompt = _trace_conditioning_upstream(pos_wire, prompt, False)
            guidance, clips, clips_raw = _trace_cond_extras(pos_wire, prompt)
        if neg_wire:
            neg_prompt = _trace_conditioning_upstream(neg_wire, prompt, True)
            if not clips:
                g2, cs2, cr2 = _trace_cond_extras(neg_wire, prompt)
                if guidance == "Unknown":
                    guidance = g2
                clips, clips_raw = cs2, cr2

        s_val = s_inputs.get("seed", s_inputs.get("noise_seed", s_inputs.get("seed_a")))
        seed = _resolve_seed_val(s_val, prompt)
        if seed == "Unknown" and "noise" in s_inputs and isinstance(s_inputs["noise"], list) and len(s_inputs["noise"]) >= 1:
            noise_node = prompt.get(str(s_inputs["noise"][0]), {})
            if isinstance(noise_node, dict):
                n_in = noise_node.get("inputs", {})
                for sk in ("noise_seed", "seed", "seed_a"):
                    if sk in n_in:
                        seed = _resolve_seed_val(n_in[sk], prompt)
                        if seed != "Unknown":
                            break

        sched_node = None
        sig_link = s_inputs.get("sigmas")
        for _ in range(5):
            if not (isinstance(sig_link, list) and len(sig_link) >= 1):
                break
            cand = prompt.get(str(sig_link[0]), {})
            if not isinstance(cand, dict):
                break
            c_in = cand.get("inputs", {}) if isinstance(cand.get("inputs"), dict) else {}
            if "scheduler" in c_in or "steps" in c_in or "denoise" in c_in:
                sched_node = cand
                break
            sig_link = c_in.get("sigmas")

        if "steps" in s_inputs:
            st_num = _resolve_scalar_num(s_inputs["steps"], prompt)
            if st_num != "Unknown":
                steps = int(st_num)
        elif sched_node:
            st_num = _resolve_scalar_num(sched_node.get("inputs", {}).get("steps"), prompt)
            if st_num != "Unknown":
                steps = int(st_num)

        if "scheduler" in s_inputs and isinstance(s_inputs["scheduler"], str) and s_inputs["scheduler"]:
            scheduler = s_inputs["scheduler"]
        elif sched_node:
            sc_val = sched_node.get("inputs", {}).get("scheduler")
            if isinstance(sc_val, str) and sc_val:
                scheduler = sc_val

        d_raw = s_inputs.get("denoise")
        if d_raw is None and sched_node:
            d_raw = sched_node.get("inputs", {}).get("denoise")
        d_num = _resolve_scalar_num(d_raw, prompt)
        if d_num != "Unknown":
            denoise = _format_num(d_num, 2)

        if "cfg" in s_inputs:
            c_num = _resolve_scalar_num(s_inputs["cfg"], prompt)
            if c_num != "Unknown":
                cfg = round(float(c_num), 1)
        elif "guider" in s_inputs and isinstance(s_inputs["guider"], list) and len(s_inputs["guider"]) >= 1:
            g_node = prompt.get(str(s_inputs["guider"][0]), {})
            if isinstance(g_node, dict):
                c_num = _resolve_scalar_num(g_node.get("inputs", {}).get("cfg"), prompt)
                if c_num != "Unknown":
                    cfg = round(float(c_num), 1)

        if "sampler_name" in s_inputs and isinstance(s_inputs["sampler_name"], str):
            sampler = s_inputs["sampler_name"]
        elif "sampler" in s_inputs and isinstance(s_inputs["sampler"], list) and len(s_inputs["sampler"]) >= 1:
            samp_node = prompt.get(str(s_inputs["sampler"][0]), {})
            if isinstance(samp_node, dict):
                s_name = samp_node.get("inputs", {}).get("sampler_name")
                sampler = s_name if (isinstance(s_name, str) and s_name) else str(samp_node.get("class_type", sampler))

        # Trace model, active LoRAs & sampling shift upstream
        model_wire = s_inputs.get("model")
        if not model_wire and "guider" in s_inputs and isinstance(s_inputs["guider"], list) and len(s_inputs["guider"]) >= 1:
            g_node = prompt.get(str(s_inputs["guider"][0]), {})
            if isinstance(g_node, dict):
                model_wire = g_node.get("inputs", {}).get("model")

        if model_wire:
            model_name, loras, shift = _trace_model_chain(model_wire, prompt)

    # Fallbacks for any missing fields
    if not pos_prompt:
        for node in prompt.values():
            if not isinstance(node, dict):
                continue
            ctype = str(node.get("class_type", ""))
            inputs = node.get("inputs", {})
            if not isinstance(inputs, dict):
                continue
            if "PromptCenter" in ctype:
                try:
                    p_data = json.loads(inputs.get("payload", "{}"))
                    if isinstance(p_data, dict) and p_data.get("positive"):
                        pos_prompt = str(p_data["positive"]).strip()
                        if not neg_prompt and p_data.get("negative"):
                            neg_prompt = str(p_data["negative"]).strip()
                        break
                except Exception:
                    pass
            elif "ArtDirector" in ctype:
                p = str(inputs.get("positive_prompt") or inputs.get("concept") or "").strip()
                if p:
                    pos_prompt = p
                    break
            elif any(k in ctype for k in ("MiniMax", "CLIPTextEncode", "Wan")):
                for tk in ("prompt", "text"):
                    tv = inputs.get(tk)
                    if isinstance(tv, str) and len(tv.strip()) > len(pos_prompt):
                        pos_prompt = tv.strip()

    if model_name == "Unknown":
        for node in prompt.values():
            if not isinstance(node, dict):
                continue
            ctype = str(node.get("class_type", ""))
            inputs = node.get("inputs", {})
            if isinstance(inputs, dict) and any(k in ctype for k in ("CheckpointLoader", "UNETLoader")):
                name = inputs.get("ckpt_name") or inputs.get("unet_name")
                if name:
                    model_name = str(name)
                    break

    pos_prompt = pos_prompt.strip()
    neg_prompt = neg_prompt.strip()

    return {
        "positive": pos_prompt,
        "negative": neg_prompt,
        "seed": seed,
        "steps": steps,
        "sampler": sampler,
        "scheduler": scheduler,
        "cfg": cfg,
        "guidance": guidance,
        "denoise": denoise,
        "shift": shift,
        "model": model_name,
        "vae_short": vae_short,
        "vae_raw": vae_raw,
        "clips": clips,
        "clips_raw": clips_raw,
        "loras": loras,
    }


def _extract_inline_lora_tags(text: str) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    if not text:
        return found
    for m in re.finditer(r"<lora:([^:>]+):([-+]?[\d.]+)(?::([-+]?[\d.]+))?>", text, re.IGNORECASE):
        raw = m.group(1).strip()
        try:
            sm = float(m.group(2))
            sc = float(m.group(3)) if m.group(3) is not None else sm
        except Exception:
            continue
        _append_lora_entry(found, raw, sm, sc)
    return found


def parse_a1111_string(text: str) -> Dict[str, Any]:
    res: Dict[str, Any] = {
        "positive": "",
        "negative": "",
        "model": "Unknown",
        "steps": "Unknown",
        "sampler": "Unknown",
        "scheduler": "Unknown",
        "cfg": "Unknown",
        "denoise": "Unknown",
        "seed": "Unknown",
        "vae_short": "Unknown",
        "vae_raw": "Unknown",
        "loras": [],
    }
    if not text or not isinstance(text, str):
        return res

    text = text.strip()
    parts = re.split(r"(?i)\nNegative prompt:\s*", text, maxsplit=1)
    if len(parts) > 1:
        res["positive"] = parts[0].strip()
        rest = parts[1]
        step_m = re.search(r"(?:^|\n)(Steps:\s*\d+.*)", rest, re.IGNORECASE | re.DOTALL)
        if step_m:
            res["negative"] = rest[:step_m.start()].strip()
            param_line = step_m.group(1)
        else:
            res["negative"] = rest.strip()
            param_line = ""
    else:
        rest = parts[0]
        step_m = re.search(r"(?:^|\n)(Steps:\s*\d+.*)", rest, re.IGNORECASE | re.DOTALL)
        if step_m:
            res["positive"] = rest[:step_m.start()].strip()
            param_line = step_m.group(1)
        else:
            res["positive"] = rest.strip()
            param_line = ""

    if res["positive"]:
        res["loras"] = _extract_inline_lora_tags(res["positive"])

    if param_line:
        for pat, key in [
            (r"(?i)Steps:\s*(\d+)", "steps"),
            (r"(?i)Sampler:\s*([^,\n]+)", "sampler"),
            (r"(?i)Schedule type:\s*([^,\n]+)", "scheduler"),
            (r"(?i)CFG scale:\s*([\d.]+)", "cfg"),
            (r"(?i)Denoising strength:\s*([\d.]+)", "denoise"),
            (r"(?i)Seed:\s*(\d+)", "seed"),
            (r"(?i)Model:\s*([^,\n]+)", "model"),
            (r"(?i)VAE:\s*([^,\n]+)", "vae_raw"),
        ]:
            m = re.search(pat, param_line)
            if m:
                res[key] = m.group(1).strip()
        if res["vae_raw"] != "Unknown":
            res["vae_short"] = _clean_asset_name(res["vae_raw"])

    return res


def extract_media_metadata(file_path: str) -> Dict[str, Any]:
    """
    Universal metadata extractor for both Images (.png, .webp, .jpg) and Videos (.mp4, .webm, .mov).
    """
    ext = os.path.splitext(file_path)[1].lower()
    is_video = ext in (".mp4", ".webm", ".mov", ".mkv")
    file_size_bytes = os.path.getsize(file_path) if os.path.exists(file_path) else 0
    file_size_mb = round(file_size_bytes / (1024 * 1024), 2)

    width = 0
    height = 0
    duration_sec = 0.0
    has_audio = False
    raw_prompt = ""
    negative_prompt = ""
    seed = "Unknown"
    sampler = "Unknown"
    scheduler = "Unknown"
    steps = "Unknown"
    cfg = "Unknown"
    guidance = "Unknown"
    denoise = "Unknown"
    shift = "Unknown"
    model_name = "Unknown"
    vae_short = "Unknown"
    vae_raw = "Unknown"
    clips: List[str] = []
    clips_raw: List[str] = []
    loras: List[Dict[str, Any]] = []
    workflow: Dict[str, Any] = {}
    prompt_dict: Dict[str, Any] = {}
    extra_tags_str = ""

    def _merge_graph_meta(g_meta: Dict[str, Any]) -> None:
        nonlocal raw_prompt, negative_prompt, seed, sampler, scheduler, steps, cfg, guidance, denoise, shift, model_name, vae_short, vae_raw, clips, clips_raw, loras
        if not raw_prompt and g_meta.get("positive"):
            raw_prompt = g_meta["positive"]
        if not negative_prompt and g_meta.get("negative"):
            negative_prompt = g_meta["negative"]
        if seed == "Unknown" and g_meta.get("seed", "Unknown") != "Unknown":
            seed = str(g_meta["seed"])
        if sampler == "Unknown" and g_meta.get("sampler", "Unknown") != "Unknown":
            sampler = str(g_meta["sampler"])
        if scheduler == "Unknown" and g_meta.get("scheduler", "Unknown") != "Unknown":
            scheduler = str(g_meta["scheduler"])
        if steps == "Unknown" and g_meta.get("steps", "Unknown") != "Unknown":
            steps = str(g_meta["steps"])
        if cfg == "Unknown" and g_meta.get("cfg", "Unknown") != "Unknown":
            cfg = str(g_meta["cfg"])
        if guidance == "Unknown" and g_meta.get("guidance", "Unknown") != "Unknown":
            guidance = str(g_meta["guidance"])
        if denoise == "Unknown" and g_meta.get("denoise", "Unknown") != "Unknown":
            denoise = str(g_meta["denoise"])
        if shift == "Unknown" and g_meta.get("shift", "Unknown") != "Unknown":
            shift = str(g_meta["shift"])
        if model_name == "Unknown" and g_meta.get("model", "Unknown") != "Unknown":
            model_name = str(g_meta["model"])
        if vae_short == "Unknown" and g_meta.get("vae_short", "Unknown") != "Unknown":
            vae_short = str(g_meta["vae_short"])
            vae_raw = str(g_meta.get("vae_raw", vae_short))
        if not clips and g_meta.get("clips"):
            clips = list(g_meta["clips"])
            clips_raw = list(g_meta.get("clips_raw") or clips)
        if not loras and g_meta.get("loras"):
            loras = list(g_meta["loras"])

    if is_video:
        try:
            creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            out = subprocess.check_output(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file_path],
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=4,
                creationflags=creation_flags,
            )
            probe = json.loads(out)
            for stream in probe.get("streams", []):
                stype = stream.get("codec_type")
                if stype == "video" and width == 0:
                    width = int(stream.get("width") or 0)
                    height = int(stream.get("height") or 0)
                    if stream.get("duration"):
                        duration_sec = round(float(stream["duration"]), 2)
                elif stype == "audio":
                    has_audio = True

            fmt = probe.get("format", {})
            if not duration_sec and fmt.get("duration"):
                duration_sec = round(float(fmt["duration"]), 2)

            tags_obj = fmt.get("tags", {}) or {}
            for k, v in tags_obj.items():
                kl = k.lower()
                if kl == "workflow" and isinstance(v, str):
                    try:
                        workflow = json.loads(v)
                    except Exception:
                        pass
                elif kl in ("prompt", "comment") and isinstance(v, str):
                    try:
                        parsed_json = json.loads(v)
                        if isinstance(parsed_json, dict):
                            if "nodes" in parsed_json and not workflow:
                                workflow = parsed_json
                            else:
                                prompt_dict = parsed_json
                    except Exception:
                        if not raw_prompt:
                            raw_prompt = v.strip()
        except Exception:
            pass

        if width == 0 or height == 0 or duration_sec == 0.0:
            cap = None
            try:
                import cv2

                cap = cv2.VideoCapture(file_path)
                if cap and cap.isOpened():
                    if width == 0:
                        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
                    if height == 0:
                        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
                    if duration_sec == 0.0:
                        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
                        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
                        if fps > 0.0 and frames > 0.0:
                            duration_sec = round(frames / fps, 2)
            except Exception:
                pass
            finally:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass

        if prompt_dict:
            _merge_graph_meta(parse_comfy_graph(prompt_dict))

        if model_name == "Unknown":
            model_name = "Video Render"

    else:
        try:
            with Image.open(file_path) as img:
                width, height = img.size
                info = getattr(img, "info", {}) or {}

                extra_tags_str = str(info.get("hammelart_tags") or info.get("tags") or "")

                # 1. Direct first-class metadata chunks
                for prefix in ("hammelart_",):
                    if info.get(f"{prefix}prompt") and not raw_prompt:
                        raw_prompt = str(info[f"{prefix}prompt"]).strip()
                    if info.get(f"{prefix}negative") and not negative_prompt:
                        negative_prompt = str(info[f"{prefix}negative"]).strip()
                    if info.get(f"{prefix}seed") and seed == "Unknown":
                        seed = str(info[f"{prefix}seed"])
                    if info.get(f"{prefix}sampler") and sampler == "Unknown":
                        sampler = str(info[f"{prefix}sampler"])
                    if info.get(f"{prefix}scheduler") and scheduler == "Unknown":
                        scheduler = str(info[f"{prefix}scheduler"])
                    if info.get(f"{prefix}steps") and steps == "Unknown":
                        steps = str(info[f"{prefix}steps"])
                    if info.get(f"{prefix}cfg") and cfg == "Unknown":
                        cfg = str(info[f"{prefix}cfg"])
                    if info.get(f"{prefix}model") and model_name == "Unknown":
                        model_name = str(info[f"{prefix}model"])

                # 2. A1111 / Parameters block
                param_str = (
                    info.get("hammelart_parameters")
                    or info.get("parameters")
                    or ""
                )
                if param_str and isinstance(param_str, str):
                    _merge_graph_meta(parse_a1111_string(param_str))

                # 3. ComfyUI workflow & prompt JSON chunks
                if "workflow" in info:
                    try:
                        workflow = json.loads(info["workflow"]) if isinstance(info["workflow"], str) else info["workflow"]
                    except Exception:
                        workflow = {}

                if "prompt" in info:
                    try:
                        prompt_dict = json.loads(info["prompt"]) if isinstance(info["prompt"], str) else info["prompt"]
                    except Exception:
                        prompt_dict = {}

                if prompt_dict:
                    _merge_graph_meta(parse_comfy_graph(prompt_dict))
        except Exception as exc:
            print(f"[HammelArt Atelier] Metadata read warning on {os.path.basename(file_path)}: {exc}")

    # Fallback: extract any <lora:...> tags inline from raw_prompt if graph didn't supply LoRAs
    if not loras and raw_prompt:
        loras = _extract_inline_lora_tags(raw_prompt)

    aspect_bucket = "square"
    aspect_ratio_val = 1.0
    if width > 0 and height > 0:
        aspect_ratio_val = round(width / height, 4)
        if aspect_ratio_val > 1.12:
            aspect_bucket = "landscape"
        elif aspect_ratio_val < 0.88:
            aspect_bucket = "portrait"

    dialect = detect_model_dialect(model_name, sampler, prompt_dict)
    tags = extract_tags_from_text(raw_prompt, extra_tags_str)
    clean_workflow = _sanitize_json_graph(workflow) if isinstance(workflow, dict) else workflow
    clean_prompt = _sanitize_json_graph(prompt_dict) if isinstance(prompt_dict, dict) else {}
    has_ui_workflow = bool(clean_workflow and isinstance(clean_workflow, dict) and len(clean_workflow) > 0)
    has_api_prompt = bool(clean_prompt and isinstance(clean_prompt, dict) and len(clean_prompt) > 0)
    has_workflow = has_ui_workflow or has_api_prompt

    short_model = _clean_asset_name(model_name)

    return {
        "meta_version": 3,
        "width": width,
        "height": height,
        "resolution": f"{width}x{height}" if (width and height) else "Unknown",
        "aspect_ratio": aspect_ratio_val,
        "aspect_bucket": aspect_bucket,
        "media_type": "video" if is_video else "image",
        "duration_sec": duration_sec,
        "has_audio": has_audio,
        "file_size_bytes": file_size_bytes,
        "file_size_mb": file_size_mb,
        "model": model_name,
        "model_short": short_model,
        "dialect": dialect,
        "seed": str(seed),
        "sampler": str(sampler),
        "scheduler": str(scheduler),
        "steps": str(steps),
        "cfg": str(cfg),
        "guidance": str(guidance),
        "denoise": str(denoise),
        "shift": str(shift),
        "vae_short": str(vae_short),
        "vae_raw": str(vae_raw),
        "clips": clips,
        "clips_raw": clips_raw,
        "loras": loras,
        "raw_prompt": raw_prompt,
        "negative_prompt": negative_prompt,
        "tags": tags,
        "has_workflow": has_workflow,
        "workflow": clean_workflow,
        "prompt_graph": clean_prompt,
    }
